/** @typedef {'correct'|'passed'} CardResult */

export function shuffle(items) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

export function nextUnusedCard(cards) {
  return shuffle(cards.filter((card) => !card.firstShownAt))[0] ?? null
}

export function createRound(packId, durationSeconds) {
  return {
    id: crypto.randomUUID(),
    packId,
    durationSeconds,
    startedAt: new Date().toISOString(),
    endedAt: null,
    outcomes: []
  }
}

export function recordOutcome(round, cardId, result) {
  return { ...round, outcomes: [...round.outcomes, { cardId, result }] }
}

export function setRoundOutcome(round, cardId, result) {
  const outcomes = round.outcomes || []
  const existingIndex = outcomes.findIndex((outcome) => outcome.cardId === cardId)
  if (existingIndex === -1) return { ...round, outcomes: [...outcomes, { cardId, result }] }
  return {
    ...round,
    outcomes: outcomes.map((outcome, index) => index === existingIndex ? { ...outcome, result } : outcome)
  }
}

export function removeLastOutcome(round) {
  return { ...round, outcomes: (round.outcomes || []).slice(0, -1) }
}

export function scoreRound(round) {
  return (round.outcomes || []).filter((outcome) => outcome.result === 'correct').length
}

// Tilt sensitivity is exposed to players as a 1-5 scale where 1 needs the
// biggest, most deliberate tip and 5 reacts to a small flick. The values are the
// angle (in degrees) the phone must rotate past its calibrated forehead baseline
// before a tip counts. Larger threshold => less sensitive => fewer accidents.
export const TILT_SENSITIVITY_THRESHOLDS = { 1: 55, 2: 45, 3: 36, 4: 29, 5: 23 }
export const TILT_SENSITIVITY_LEVELS = [1, 2, 3, 4, 5]
export const TILT_SENSITIVITY_MIN = 1
export const TILT_SENSITIVITY_MAX = 5
// Default deliberately favours a firm tip so casual jostling does not register.
export const DEFAULT_TILT_SENSITIVITY = 2

export function tiltThresholdForSensitivity(level) {
  return TILT_SENSITIVITY_THRESHOLDS[level] ?? TILT_SENSITIVITY_THRESHOLDS[DEFAULT_TILT_SENSITIVITY]
}

export function createTiltDetector({ threshold = tiltThresholdForSensitivity(DEFAULT_TILT_SENSITIVITY), neutralBand = 10, cooldownMs = 700 } = {}) {
  let baseline = null
  let armed = true
  let lastTriggerAt = 0

  return {
    calibrate(samples) {
      if (!samples.length) return null
      baseline = samples.reduce((total, sample) => total + sample, 0) / samples.length
      armed = true
      return baseline
    },
    read(pitch, now = Date.now()) {
      if (baseline === null || now - lastTriggerAt < cooldownMs) return null
      const delta = pitch - baseline
      if (Math.abs(delta) <= neutralBand) armed = true
      if (!armed) return null
      if (delta >= threshold) {
        armed = false
        lastTriggerAt = now
        return 'correct'
      }
      if (delta <= -threshold) {
        armed = false
        lastTriggerAt = now
        return 'passed'
      }
      return null
    }
  }
}
