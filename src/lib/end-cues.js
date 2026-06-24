let audioContext = null

function context() {
  if (audioContext) return audioContext
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  audioContext = new AudioContext()
  return audioContext
}

export function prepareEndCueAudio(mode) {
  if (mode === 'visual') return
  const audio = context()
  if (audio?.state === 'suspended') audio.resume().catch(() => {})
}

export function playCountdownTone(secondsLeft) {
  const audio = context()
  if (!audio || audio.state !== 'running') return
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  const now = audio.currentTime
  oscillator.type = secondsLeft <= 2 ? 'square' : 'sine'
  oscillator.frequency.setValueAtTime(430 + (5 - secondsLeft) * 115, now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(secondsLeft <= 2 ? 0.16 : 0.1, now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.12)
}

export function playFinishTone() {
  const audio = context()
  if (!audio || audio.state !== 'running') return
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  const now = audio.currentTime
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(920, now)
  oscillator.frequency.setValueAtTime(1240, now + 0.11)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.27)
}
