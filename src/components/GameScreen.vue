<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Motion } from '@capacitor/motion'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { createRound, createTiltDetector, recordOutcome, removeLastOutcome, shuffle, tiltThresholdForSensitivity, DEFAULT_TILT_SENSITIVITY } from '../lib/game-engine.js'
import { markCardShown, unmarkCardsShown } from '../lib/database.js'
import { playCountdownTone, playFinishTone, playGoTone, playOutcomeTone, playStartCountdownTone, playUndoTone } from '../lib/end-cues.js'

const props = defineProps({ pack: { type: Object, required: true }, cards: { type: Array, required: true }, duration: { type: Number, required: true }, controlMode: { type: String, default: 'both' }, tiltSensitivity: { type: Number, default: DEFAULT_TILT_SENSITIVITY }, startCountdown: { type: Number, default: 5 }, endCueMode: { type: String, default: 'sound_haptics' }, confirmAbort: { type: Function, default: null } })
const emit = defineEmits(['finish', 'abort'])
const countdown = ref(Math.max(1, Math.round(props.startCountdown) || 5))
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
const tiltEnabled = computed(() => props.controlMode !== 'buttons')
const showManualControls = computed(() => props.controlMode !== 'tilt')
const detector = createTiltDetector({ threshold: tiltThresholdForSensitivity(props.tiltSensitivity) })
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
const soundCuesEnabled = computed(() => (props.endCueMode === 'sound' || props.endCueMode === 'sound_haptics') && !cueMuted.value)
const hapticCuesEnabled = computed(() => (props.endCueMode === 'haptics' || props.endCueMode === 'sound_haptics') && !cueMuted.value)
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
const GRAVITY = 9.81
// Flip detection runs off the accelerometer's gravity vector, not the
// deviceorientation angles. The screen-normal (z) component is ~0 while the phone is
// held vertically at the forehead and swings toward ±g as the screen tilts down or
// up. Per the W3C accelerometer spec the device frame stays fixed regardless of the
// screen-orientation lock, so this works the same in either landscape direction and
// avoids the beta/gamma axis swap of a sideways hold.
//
// iOS reports accelerationIncludingGravity with the opposite sign of Android/Chrome
// (iOS: screen-up => z ≈ -9.8; Android: z ≈ +9.8). TILT_SIGN normalizes both so a
// downward flip (screen toward the floor) always yields a positive angle, which the
// detector maps to "correct"; an upward flip yields a negative angle => "pass".
const TILT_SIGN = Capacitor.getPlatform() === 'ios' ? 1 : -1

function tiltAngle(event, source) {
  if (source === 'accel') {
    // Only the gravity-inclusive vector encodes static tilt; plain `acceleration`
    // is gravity-compensated (~0 at rest) and cannot measure a hold angle.
    const z = Number(event.accelerationIncludingGravity?.z)
    if (!Number.isFinite(z)) return null
    const ratio = Math.max(-1, Math.min(1, z / GRAVITY))
    return (Math.asin(ratio) * 180 / Math.PI) * TILT_SIGN
  }
  // Orientation fallback (rarely used: iOS and Android both emit `accel`). In a
  // landscape forehead hold the flip rotates around gamma, not beta.
  const gamma = Number(event.gamma)
  if (Number.isFinite(gamma)) return gamma * TILT_SIGN
  const beta = Number(event.beta)
  return Number.isFinite(beta) ? beta * TILT_SIGN : null
}

function onMotion(event, source) {
  if (!tiltEnabled.value) return
  // Compute first so an unusable reading never claims the active source.
  const pitch = tiltAngle(event, source)
  if (pitch === null) return
  // Prefer the accelerometer: it is the reliable, orientation-independent signal.
  if (motionSource === 'accel' && source !== 'accel') return
  if (source === 'accel' && motionSource !== 'accel') {
    motionSource = 'accel'
    if (!started.value) calibrationSamples.length = 0
  } else if (!motionSource) {
    motionSource = source
  } else if (source !== motionSource) {
    return
  }
  if (!started.value) {
    calibrationSamples.push(pitch)
    return
  }
  const result = detector.read(pitch)
  if (result) respond(result)
}

// iOS auto-locks the screen after the idle timer expires when no touches occur,
// which happens constantly in tilt mode where the phone is held to the forehead.
// Disabling the idle timer (native) / holding a screen wake lock (web) keeps the
// round alive without any taps. Guarded so it never throws on unsupported platforms.
let screenAwake = false
async function keepScreenAwake() {
  try {
    await KeepAwake.keepAwake()
    screenAwake = true
  } catch {
    screenAwake = false
  }
}

async function allowScreenSleep() {
  if (!screenAwake) return
  screenAwake = false
  try {
    await KeepAwake.allowSleep()
  } catch {
    /* no-op: best effort */
  }
}

function onVisibility() {
  hiddenPaused.value = document.hidden
  // Returning from background can drop a web wake lock; re-assert while the round runs.
  if (!document.hidden && !roundFinished.value) keepScreenAwake()
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
  keepScreenAwake()
  if (tiltEnabled.value) {
    Motion.addListener('orientation', (event) => onMotion(event, 'orientation')).then((listener) => { motionListeners.push(listener) }).catch(() => {})
    Motion.addListener('accel', (event) => onMotion(event, 'accel')).then((listener) => { motionListeners.push(listener) }).catch(() => {})
  }
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
  allowScreenSleep()
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
      <small>{{ tiltEnabled ? 'We’re calibrating the tilt.' : 'Use the on-screen buttons to score.' }}</small>
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
