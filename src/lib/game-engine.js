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

export function createTiltDetector({ threshold = 24, neutralBand = 10, cooldownMs = 700 } = {}) {
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
