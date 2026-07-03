<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { TUTORIAL_SLIDES } from '../lib/tutorial-slides.js'

defineProps({
  manual: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'complete'])

const slides = TUTORIAL_SLIDES
const total = slides.length
const currentIndex = ref(0)
const dragPx = ref(0)
const isDragging = ref(false)
const viewportRef = ref(null)
const liveMessage = ref('')

const currentSlide = computed(() => slides[currentIndex.value])
const isFirst = computed(() => currentIndex.value === 0)
const isLast = computed(() => currentIndex.value === total - 1)
const accent = computed(() => currentSlide.value.accent || '#ffe663')
const webBuild = !Capacitor.isNativePlatform()

const trackStyle = computed(() => ({
  transform: `translateX(calc(-${currentIndex.value * 100}% + ${dragPx.value}px))`,
  transition: isDragging.value ? 'none' : 'transform 0.42s cubic-bezier(0.22, 1, 0.36, 1)'
}))

let pointerStartX = 0
let pointerStartY = 0
let pointerActive = false
let axisLocked = false
let horizontalSwipe = false

function announceSlide() {
  const slide = currentSlide.value
  liveMessage.value = `Slide ${currentIndex.value + 1} of ${total}: ${slide.title}`
}

function hapticTap(style = ImpactStyle.Light) {
  if (!Capacitor.isNativePlatform()) return
  Haptics.impact({ style }).catch(() => {})
}

function goTo(index) {
  const next = Math.max(0, Math.min(total - 1, index))
  if (next === currentIndex.value) return
  currentIndex.value = next
  dragPx.value = 0
  hapticTap()
  announceSlide()
}

function goNext() {
  if (isLast.value) {
    hapticTap(ImpactStyle.Medium)
    emit('complete')
    return
  }
  goTo(currentIndex.value + 1)
}

function goBack() {
  if (isFirst.value) return
  goTo(currentIndex.value - 1)
}

function skip() {
  emit('close')
}

function onPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  pointerActive = true
  axisLocked = false
  horizontalSwipe = false
  isDragging.value = true
  pointerStartX = event.clientX ?? event.touches?.[0]?.clientX ?? 0
  pointerStartY = event.clientY ?? event.touches?.[0]?.clientY ?? 0
  if (event.type === 'mousedown') {
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUpWindow)
  }
}

function onPointerUpWindow(event) {
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUpWindow)
  onPointerUp(event)
}

function onPointerMove(event) {
  if (!pointerActive) return
  const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0
  const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0
  const deltaX = clientX - pointerStartX
  const deltaY = clientY - pointerStartY

  if (!axisLocked) {
    if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return
    axisLocked = true
    horizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY)
    if (!horizontalSwipe) {
      pointerActive = false
      isDragging.value = false
      dragPx.value = 0
      return
    }
  }

  if (!horizontalSwipe) return
  if (event.cancelable) event.preventDefault()

  let nextDrag = deltaX
  if (isFirst.value && nextDrag > 0) nextDrag *= 0.35
  if (isLast.value && nextDrag < 0) nextDrag *= 0.35
  dragPx.value = nextDrag
}

function onPointerUp(event) {
  if (!pointerActive) return
  pointerActive = false
  isDragging.value = false

  const clientX = event.clientX ?? event.changedTouches?.[0]?.clientX ?? pointerStartX
  const deltaX = clientX - pointerStartX
  const width = viewportRef.value?.clientWidth || window.innerWidth
  const threshold = width * 0.22
  const velocity = Math.abs(deltaX)

  if (deltaX <= -threshold || (deltaX < -40 && velocity > 40)) {
    goNext()
    return
  }
  if (deltaX >= threshold || (deltaX > 40 && velocity > 40)) {
    goBack()
    return
  }

  dragPx.value = 0
}

function onKeyDown(event) {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    goNext()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goBack()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    skip()
  }
}

onMounted(() => {
  announceSlide()
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUpWindow)
})
</script>

<template>
  <div class="tutorial-overlay" :style="{ '--accent': accent }">
    <div class="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-slide-title">
    <div class="tutorial-glow" aria-hidden="true"></div>

    <header class="tutorial-topbar">
      <p class="tutorial-counter" aria-hidden="true"><b>{{ currentIndex + 1 }}</b><span>/ {{ total }}</span></p>
      <button type="button" class="tutorial-skip" @click="skip">Skip</button>
    </header>

    <p class="visually-hidden" aria-live="polite">{{ liveMessage }}</p>

    <div
      ref="viewportRef"
      class="tutorial-viewport"
      :aria-label="`Slide ${currentIndex + 1} of ${total}`"
      @mousedown="onPointerDown"
      @touchstart="onPointerDown"
      @touchmove="onPointerMove"
      @touchend="onPointerUp"
      @touchcancel="onPointerUp"
    >
      <div class="tutorial-track" :style="trackStyle">
        <article
          v-for="(slide, index) in slides"
          :key="slide.id"
          :class="['tutorial-slide', { 'is-active': index === currentIndex }]"
          :style="{ '--accent': slide.accent }"
        >
          <div class="tutorial-stage" aria-hidden="true">
            <!-- Welcome -->
            <div v-if="slide.mockup === 'welcome'" class="ff-scene ff-welcome">
              <span class="ff-spark ff-spark-1">✦</span>
              <span class="ff-spark ff-spark-2">★</span>
              <span class="ff-spark ff-spark-3">✦</span>
              <div class="ff-welcome-art">
                <img src="/forehead-frenzy-launch-art.png" alt="" />
              </div>
              <div class="ff-welcome-card ff-welcome-card-a">PIZZA</div>
              <div class="ff-welcome-card ff-welcome-card-b">TIGER</div>
            </div>

            <!-- Pick a pack -->
            <div v-else-if="slide.mockup === 'pick-pack'" class="ff-scene ff-pick">
              <div class="ff-pack-row">
                <div class="ff-pack" style="--i: 0"><span>🎬</span><b>Movies</b></div>
                <div class="ff-pack ff-pack-active" style="--i: 1"><span>🍕</span><b>Food</b><i class="ff-tap"></i></div>
                <div class="ff-pack" style="--i: 2"><span>⚽</span><b>Sports</b></div>
              </div>
              <div class="ff-duration">
                <span>30s</span><span class="ff-duration-active">60s</span><span>90s</span>
              </div>
              <div class="ff-start-btn">Start round ▸</div>
            </div>

            <!-- Hold to forehead -->
            <div v-else-if="slide.mockup === 'hold-phone'" class="ff-scene ff-hold">
              <div class="ff-hands">
                <div class="ff-head">
                  <span class="ff-eye ff-eye-l"></span>
                  <span class="ff-eye ff-eye-r"></span>
                  <span class="ff-mouth"></span>
                  <div class="ff-fore-phone"><span>PIZZA</span></div>
                  <span class="ff-hand ff-hand-l"></span>
                  <span class="ff-hand ff-hand-r"></span>
                </div>
              </div>
              <p class="ff-caption"><span class="ff-caption-eyes">👀</span> Screen faces your friends</p>
            </div>

            <!-- Friends give clues -->
            <div v-else-if="slide.mockup === 'get-clues'" class="ff-scene ff-clues">
              <div class="ff-clue ff-clue-1">“It’s cheesy!”</div>
              <div class="ff-word-card">PIZZA</div>
              <div class="ff-clue ff-clue-2">“You order it!”</div>
              <div class="ff-clue ff-clue-3">“Italian food!”</div>
              <div class="ff-friends">
                <span class="ff-friend">🙂</span>
                <span class="ff-friend">😃</span>
                <span class="ff-friend">😅</span>
              </div>
            </div>

            <!-- Tilt to score -->
            <div v-else-if="slide.mockup === 'score-cards'" class="ff-scene ff-tilt">
              <div class="ff-tilt-col ff-tilt-col-correct">
                <div class="ff-tilt-phone ff-tilt-phone-down">
                  <span class="ff-tilt-arrow">↓</span>
                </div>
                <b class="ff-tilt-label">Correct</b>
              </div>
              <div class="ff-tilt-col ff-tilt-col-pass">
                <div class="ff-tilt-phone ff-tilt-phone-up">
                  <span class="ff-tilt-arrow">↑</span>
                </div>
                <b class="ff-tilt-label">Pass</b>
              </div>
            </div>

            <!-- Beat the clock -->
            <div v-else-if="slide.mockup === 'beat-clock'" class="ff-scene ff-clock">
              <div class="ff-game-card">
                <span class="ff-timer-pill"><b>7</b><small>SEC</small></span>
                <h3>PIZZA</h3>
                <div class="ff-timer-bar"><i></i></div>
              </div>
            </div>

            <!-- Make your own deck -->
            <div v-else-if="slide.mockup === 'make-deck'" class="ff-scene ff-create">
              <span class="ff-spark ff-spark-1">✦</span>
              <span class="ff-spark ff-spark-2">✦</span>
              <div class="ff-create-card">
                <div class="ff-create-btn"><span class="hero-ai-spark">✦</span><span>Make a pack with</span><span class="hero-ai-badge">AI</span></div>
                <div class="ff-create-source">
                  <span :class="['ff-create-source-badge', { 'ff-create-source-badge-cloud': webBuild }]">{{ webBuild ? 'Cloud AI' : 'On-Device' }}</span>
                  <span class="ff-create-source-note">{{ webBuild ? 'Gemini or OpenAI key' : 'Private · no API key' }}</span>
                </div>
                <div class="ff-create-input"><span>90s cartoons</span><i class="ff-caret"></i></div>
                <div class="ff-create-progress"><i></i></div>
                <small>{{ webBuild ? 'Generating with your API key…' : 'Generating on your phone…' }}</small>
              </div>
            </div>

            <!-- Ready -->
            <div v-else-if="slide.mockup === 'ready'" class="ff-scene ff-ready">
              <span class="ff-confetti ff-confetti-1"></span>
              <span class="ff-confetti ff-confetti-2"></span>
              <span class="ff-confetti ff-confetti-3"></span>
              <span class="ff-confetti ff-confetti-4"></span>
              <span class="ff-confetti ff-confetti-5"></span>
              <div class="ff-ready-badge">🎉</div>
            </div>
          </div>

          <div class="tutorial-sheet">
            <p class="eyebrow" style="--i: 0">{{ slide.eyebrow }}</p>
            <h2 :id="index === currentIndex ? 'tutorial-slide-title' : undefined" style="--i: 1">{{ slide.title }}</h2>
            <p class="tutorial-body" style="--i: 2">{{ slide.body }}</p>
            <ul class="tutorial-points">
              <li v-for="(point, pIndex) in slide.points" :key="pIndex" :style="{ '--i': pIndex + 3 }">
                <span class="tutorial-check" aria-hidden="true">✓</span>{{ point }}
              </li>
            </ul>
          </div>
        </article>
      </div>
    </div>

    <nav class="tutorial-dots" aria-label="Tutorial progress">
      <button
        v-for="(slide, index) in slides"
        :key="slide.id"
        type="button"
        :class="['tutorial-dot', { active: index === currentIndex, done: index < currentIndex }]"
        :aria-label="`Go to slide ${index + 1}: ${slide.title}`"
        :aria-current="index === currentIndex ? 'step' : undefined"
        @click="goTo(index)"
      />
    </nav>

    <footer class="tutorial-footer">
      <button type="button" class="tutorial-back" :disabled="isFirst" @click="goBack">‹ Back</button>
      <button type="button" class="tutorial-next" @click="goNext">
        {{ isLast ? 'Let\'s play!' : 'Next' }}
        <span v-if="!isLast" aria-hidden="true">›</span>
        <span v-else aria-hidden="true">🎉</span>
      </button>
    </footer>
    </div>
  </div>
</template>
