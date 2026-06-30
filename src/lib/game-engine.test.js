import { describe, expect, it } from 'vitest'
import { createRound, createTiltDetector, DEFAULT_TILT_SENSITIVITY, nextUnusedCard, recordOutcome, removeLastOutcome, scoreRound, setRoundOutcome, tiltThresholdForSensitivity, TILT_SENSITIVITY_THRESHOLDS } from './game-engine.js'

describe('game engine', () => {
  it('only draws cards that have not appeared', () => {
    const card = nextUnusedCard([{ id: 'old', firstShownAt: '2026-01-01' }, { id: 'new', firstShownAt: null }])
    expect(card.id).toBe('new')
  })

  it('scores only correct results', () => {
    let round = createRound('pack', 60)
    round = recordOutcome(round, 'a', 'correct')
    round = recordOutcome(round, 'b', 'passed')
    expect(scoreRound(round)).toBe(1)
  })

  it('can correct an existing outcome or add one for the final unmarked card', () => {
    let round = createRound('pack', 60)
    round = recordOutcome(round, 'a', 'passed')
    round = setRoundOutcome(round, 'a', 'correct')
    round = setRoundOutcome(round, 'b', 'passed')

    expect(round.outcomes).toEqual([
      { cardId: 'a', result: 'correct' },
      { cardId: 'b', result: 'passed' }
    ])
  })

  it('can undo the last scored card', () => {
    let round = createRound('pack', 60)
    round = recordOutcome(round, 'a', 'correct')
    round = recordOutcome(round, 'b', 'passed')
    round = removeLastOutcome(round)

    expect(round.outcomes).toEqual([{ cardId: 'a', result: 'correct' }])
  })

  it('maps tilt sensitivity so lower levels require a bigger tip', () => {
    expect(tiltThresholdForSensitivity(1)).toBeGreaterThan(tiltThresholdForSensitivity(5))
    expect(tiltThresholdForSensitivity(undefined)).toBe(TILT_SENSITIVITY_THRESHOLDS[DEFAULT_TILT_SENSITIVITY])
    expect(tiltThresholdForSensitivity(99)).toBe(TILT_SENSITIVITY_THRESHOLDS[DEFAULT_TILT_SENSITIVITY])
  })

  it('defaults to a firm, less-sensitive tip that ignores small jostles', () => {
    const detector = createTiltDetector()
    detector.calibrate([0, 0, 0])
    expect(detector.read(20, 1000)).toBeNull()
    expect(detector.read(tiltThresholdForSensitivity(DEFAULT_TILT_SENSITIVITY) + 1, 2000)).toBe('correct')
  })

  it('requires a return to neutral before another tilt', () => {
    const detector = createTiltDetector({ threshold: 20, neutralBand: 8, cooldownMs: 0 })
    detector.calibrate([0, 0, 0])
    expect(detector.read(25, 1)).toBe('correct')
    expect(detector.read(30, 2)).toBeNull()
    expect(detector.read(0, 3)).toBeNull()
    expect(detector.read(-25, 4)).toBe('passed')
  })
})
