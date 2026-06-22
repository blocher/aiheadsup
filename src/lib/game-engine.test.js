import { describe, expect, it } from 'vitest'
import { createRound, createTiltDetector, nextUnusedCard, recordOutcome, scoreRound } from './game-engine.js'

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

  it('requires a return to neutral before another tilt', () => {
    const detector = createTiltDetector({ threshold: 20, neutralBand: 8, cooldownMs: 0 })
    detector.calibrate([0, 0, 0])
    expect(detector.read(25, 1)).toBe('correct')
    expect(detector.read(30, 2)).toBeNull()
    expect(detector.read(0, 3)).toBeNull()
    expect(detector.read(-25, 4)).toBe('passed')
  })
})
