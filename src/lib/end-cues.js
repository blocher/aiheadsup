let audioContext = null

function context() {
  if (audioContext) return audioContext
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  audioContext = new AudioContext()
  return audioContext
}

function playTone({ frequency = 440, duration = 0.12, gainPeak = 0.12, type = 'sine', startAt = 0 }) {
  const audio = context()
  if (!audio || audio.state !== 'running') return
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  const now = audio.currentTime + startAt
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(now)
  oscillator.stop(now + duration + 0.02)
}

export function prepareEndCueAudio(mode) {
  if (mode === 'visual') return
  const audio = context()
  if (audio?.state === 'suspended') audio.resume().catch(() => {})
}

export function playCountdownTone(secondsLeft) {
  playTone({
    frequency: 430 + (5 - secondsLeft) * 115,
    duration: 0.11,
    gainPeak: secondsLeft <= 2 ? 0.16 : 0.1,
    type: secondsLeft <= 2 ? 'square' : 'sine'
  })
}

export function playStartCountdownTone(countdown) {
  playTone({
    frequency: 520 + (3 - countdown) * 130,
    duration: 0.14,
    gainPeak: countdown <= 1 ? 0.16 : 0.11,
    type: countdown <= 1 ? 'square' : 'triangle'
  })
}

export function playGoTone() {
  playTone({ frequency: 760, duration: 0.12, gainPeak: 0.15, type: 'triangle' })
  playTone({ frequency: 1040, duration: 0.16, gainPeak: 0.13, type: 'sine', startAt: 0.08 })
}

export function playOutcomeTone(result) {
  if (result === 'correct') {
    playTone({ frequency: 660, duration: 0.08, gainPeak: 0.1, type: 'triangle' })
    playTone({ frequency: 920, duration: 0.1, gainPeak: 0.11, type: 'triangle', startAt: 0.055 })
    return
  }
  playTone({ frequency: 260, duration: 0.09, gainPeak: 0.09, type: 'sawtooth' })
  playTone({ frequency: 190, duration: 0.12, gainPeak: 0.08, type: 'sine', startAt: 0.065 })
}

export function playUndoTone() {
  playTone({ frequency: 480, duration: 0.08, gainPeak: 0.08, type: 'triangle' })
  playTone({ frequency: 340, duration: 0.1, gainPeak: 0.07, type: 'triangle', startAt: 0.055 })
}

export function playFinishTone() {
  playTone({ frequency: 920, duration: 0.13, gainPeak: 0.16, type: 'triangle' })
  playTone({ frequency: 1240, duration: 0.16, gainPeak: 0.14, type: 'triangle', startAt: 0.11 })
  playTone({ frequency: 620, duration: 0.2, gainPeak: 0.1, type: 'sine', startAt: 0.24 })
}
