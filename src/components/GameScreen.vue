<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Motion } from '@capacitor/motion'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { createRound, createTiltDetector, recordOutcome, removeLastOutcome, shuffle } from '../lib/game-engine.js'
import { markCardShown, unmarkCardsShown } from '../lib/database.js'
import { playCountdownTone, playFinishTone, playGoTone, playOutcomeTone, playStartCountdownTone, playUndoTone } from '../lib/end-cues.js'

const props = defineProps({ pack: { type: Object, required: true }, cards: { type: Array, required: true }, duration: { type: Number, required: true }, showManualControls: { type: Boolean, default: true }, endCueMode: { type: String, default: 'sound_haptics' }, confirmAbort: { type: Function, default: null } })
const emit = defineEmits(['finish', 'abort'])
const countdown = ref(3)
const secondsLeft = ref(props.duration)
const started = ref(false)
const manuallyPaused = ref(false)
const hiddenPaused = ref(false)
const cueMuted = ref(false)
const launchCue = ref('countdown')
const feedback = ref(null)
const roundFinished = ref(false)
const available = ref(shuffle(props.cards))
const current = ref(null)
const round = ref(createRound(props.pack.id, props.duration))
const detector = createTiltDetector()
const calibrationSamples = []
const shownCards = []
let countdownTimer
let roundTimer
let launchTimer
const motionListeners = []
let motionSource = null
let feedbackTimer

const score = computed(() => round.value.outcomes.filter((outcome) => outcome.result === 'correct').length)
const passCount = computed(() => round.value.outcomes.filter((outcome) => outcome.result === 'passed').length)
const canUndo = computed(() => started.value && !roundFinished.value && round.value.outcomes.length > 0)
const timeProgress = computed(() => `${Math.max(0, (secondsLeft.value / props.duration) * 100)}%`)
const paused = computed(() => manuallyPaused.value || hiddenPaused.value)
const finalCountdown = computed(() => started.value && !paused.value && secondsLeft.value <= 5)
const criticalCountdown = computed(() => finalCountdown.value && secondsLeft.value <= 3)
const soundCuesEnabled = computed(() => props.endCueMode !== 'visual' && !cueMuted.value)
const hapticCuesEnabled = computed(() => props.endCueMode === 'sound_haptics' && !cueMuted.value)
const countdownDisplay = computed(() => launchCue.value === 'go' ? 'GO' : countdown.value)

async function showNext() {
  const next = available.value.shift() ?? null
  if (roundFinished.value) return false
  if (!next) {
    if (soundCuesEnabled.value) playFinishTone()
    if (hapticCuesEnabled.value) Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})
    await finish('cards_exhausted')
    return false
  }
  current.value = await markCardShown(next.id)
  shownCards.push({ id: current.value.id, prompt: current.value.prompt })
  return true
}

async function respond(result) {
  if (roundFinished.value || !started.value || paused.value || !current.value || feedback.value) return
  feedback.value = result
  round.value = recordOutcome(round.value, current.value.id, result)
  if (soundCuesEnabled.value) playOutcomeTone(result)
  if (hapticCuesEnabled.value) Haptics.impact({ style: result === 'correct' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {})
  feedbackTimer = window.setTimeout(async () => {
    if (roundFinished.value) return
    feedback.value = null
    await showNext()
  }, 360)
}

function undoLastCard() {
  if (!canUndo.value) return
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  feedback.value = null
  const lastOutcome = round.value.outcomes.at(-1)
  const previousCard = shownCards.find((card) => card.id === lastOutcome.cardId)
  if (!previousCard) return
  if (current.value && current.value.id !== previousCard.id) available.value = [current.value, ...available.value]
  round.value = removeLastOutcome(round.value)
  current.value = previousCard
  if (soundCuesEnabled.value) playUndoTone()
  if (hapticCuesEnabled.value) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

const GAME_ORIENTATION = 'landscape-primary'
// landscape-primary is the usual phone rotation (charging port on the right).
// Negate pitch so forehead tilts still map down -> correct and up -> pass.
const ORIENTATION_PITCH_SIGN = GAME_ORIENTATION === 'landscape-primary' ? -1 : 1

function pitchFrom(event, source) {
  const raw = source === 'orientation'
    ? Number(event.beta ?? event.x ?? 0)
    : Number(event.x ?? event.accelerationIncludingGravity?.x ?? event.accelerationIncludingGravity?.y ?? 0)
  return raw * ORIENTATION_PITCH_SIGN
}

function onMotion(event, source) {
  if (!motionSource) motionSource = source
  if (source !== motionSource) return
  const pitch = pitchFrom(event, source)
  if (!started.value) {
    calibrationSamples.push(pitch)
    return
  }
  const result = detector.read(pitch)
  if (result) respond(result)
}

function onVisibility() {
  hiddenPaused.value = document.hidden
}

function togglePause() {
  manuallyPaused.value = !manuallyPaused.value
}

function toggleMute() {
  cueMuted.value = !cueMuted.value
  if (!cueMuted.value && hapticCuesEnabled.value) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

function preventGameZoom(event) {
  if (event.type.startsWith('gesture') || event.touches?.length > 1) event.preventDefault()
}

function playEndCue() {
  if (soundCuesEnabled.value) playCountdownTone(secondsLeft.value)
  if (hapticCuesEnabled.value) Haptics.impact({ style: secondsLeft.value <= 2 ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {})
}

function playLaunchCue() {
  if (launchCue.value === 'go') {
    if (soundCuesEnabled.value) playGoTone()
    if (hapticCuesEnabled.value) Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})
    return
  }
  if (soundCuesEnabled.value) playStartCountdownTone(countdown.value)
  if (hapticCuesEnabled.value) Haptics.impact({ style: countdown.value <= 1 ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {})
}

async function beginRound() {
  detector.calibrate(calibrationSamples.length ? calibrationSamples : [0])
  if (!(await showNext())) return
  started.value = true
  roundTimer = window.setInterval(() => {
    if (paused.value) return
    secondsLeft.value -= 1
    if (secondsLeft.value <= 0) {
      if (soundCuesEnabled.value) playFinishTone()
      if (hapticCuesEnabled.value) Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})
      finish('time')
      return
    }
    if (secondsLeft.value <= 5) playEndCue()
  }, 1000)
}

async function finish(endedReason = 'manual') {
  if (roundFinished.value) return
  roundFinished.value = true
  started.value = false
  cleanupRound()
  const completedRound = JSON.parse(JSON.stringify(round.value))
  const scoredCardIds = new Set(completedRound.outcomes.map((outcome) => outcome.cardId))
  const finalCardId = current.value && !scoredCardIds.has(current.value.id) ? current.value.id : null
  emit('finish', {
    ...completedRound,
    endedAt: new Date().toISOString(),
    endedReason,
    finalCardId,
    cards: shownCards
  })
  ScreenOrientation.unlock().catch(() => {})
}

function cleanupRound() {
  if (roundTimer) window.clearInterval(roundTimer)
  if (countdownTimer) window.clearInterval(countdownTimer)
  if (launchTimer) window.clearTimeout(launchTimer)
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  motionListeners.forEach((listener) => listener?.remove?.())
}

async function requestAbort() {
  if (roundFinished.value) return false
  const wasManuallyPaused = manuallyPaused.value
  manuallyPaused.value = true
  const confirmed = props.confirmAbort ? await props.confirmAbort() : true
  if (!confirmed) {
    manuallyPaused.value = wasManuallyPaused
    return false
  }
  roundFinished.value = true
  started.value = false
  await unmarkCardsShown(shownCards.map((card) => card.id))
  cleanupRound()
  ScreenOrientation.unlock().catch(() => {})
  emit('abort')
  return true
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('touchmove', preventGameZoom, { passive: false })
  document.addEventListener('gesturestart', preventGameZoom, { passive: false })
  document.addEventListener('gesturechange', preventGameZoom, { passive: false })
  document.addEventListener('gestureend', preventGameZoom, { passive: false })
  ScreenOrientation.lock({ orientation: GAME_ORIENTATION }).catch(() => {})
  Motion.addListener('orientation', (event) => onMotion(event, 'orientation')).then((listener) => { motionListeners.push(listener) }).catch(() => {})
  Motion.addListener('accel', (event) => onMotion(event, 'accel')).then((listener) => { motionListeners.push(listener) }).catch(() => {})
  playLaunchCue()
  countdownTimer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      window.clearInterval(countdownTimer)
      launchCue.value = 'go'
      playLaunchCue()
      launchTimer = window.setTimeout(() => beginRound(), 280)
      return
    }
    playLaunchCue()
  }, 1000)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('touchmove', preventGameZoom)
  document.removeEventListener('gesturestart', preventGameZoom)
  document.removeEventListener('gesturechange', preventGameZoom)
  document.removeEventListener('gestureend', preventGameZoom)
  if (roundTimer) window.clearInterval(roundTimer)
  if (countdownTimer) window.clearInterval(countdownTimer)
  if (launchTimer) window.clearTimeout(launchTimer)
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  motionListeners.forEach((listener) => listener?.remove?.())
  ScreenOrientation.unlock().catch(() => {})
})

defineExpose({ endRound: finish, requestAbort })
</script>

<template>
  <main class="game-screen" :class="[feedback, { 'time-warning': finalCountdown, 'time-critical': criticalCountdown, 'launch-go': launchCue === 'go' && !started }]">
    <div class="game-hud">
      <div class="game-control-cluster">
        <button class="game-icon-button cancel" aria-label="Quit round" @click="requestAbort">×</button>
        <button class="game-icon-button" aria-label="Go back one card" :disabled="!canUndo" @click="undoLastCard">↶</button>
      </div>
      <div class="game-stats" aria-label="Round stats">
        <span class="timer-pill"><b>{{ secondsLeft }}</b><small>sec</small></span>
        <span class="good"><b>{{ score }}</b><small>✓</small></span>
        <span class="bad"><b>{{ passCount }}</b><small>×</small></span>
      </div>
      <div class="game-control-cluster right">
        <button class="game-icon-button" :aria-label="cueMuted ? 'Unmute game cues' : 'Mute game cues'" :aria-pressed="cueMuted" @click="toggleMute">{{ cueMuted ? '🔇' : '🔊' }}</button>
        <button class="game-icon-button" :aria-label="manuallyPaused ? 'Resume round' : 'Pause round'" :disabled="!started" @click="togglePause">{{ manuallyPaused ? '▶' : 'Ⅱ' }}</button>
      </div>
    </div>
    <div class="game-progress" aria-hidden="true"><i :style="{ width: timeProgress }"></i></div>
    <section v-if="!started" class="countdown-card">
      <p>Hold the phone to your forehead</p>
      <strong>{{ countdownDisplay }}</strong>
      <small>We’re calibrating the tilt.</small>
    </section>
    <section v-else-if="paused" class="countdown-card"><p>Round paused</p><strong>◔</strong><small>{{ manuallyPaused ? 'Tap Resume to keep playing.' : 'Return to the game to continue.' }}</small></section>
    <section v-else class="prompt-card">
      <p class="prompt-pack">{{ pack.title }}</p>
      <h1>{{ current?.prompt }}</h1>
    </section>
    <footer v-if="started && !paused && showManualControls" class="game-actions">
      <button class="pass-button" @click="respond('passed')">Pass <span>↑</span></button>
      <button class="correct-button" @click="respond('correct')">Correct <span>↓</span></button>
    </footer>
  </main>
</template>
