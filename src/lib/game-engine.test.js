import { describe, expect, it } from 'vitest'
import { createRound, createTiltDetector, nextUnusedCard, recordOutcome, removeLastOutcome, scoreRound, setRoundOutcome } from './game-engine.js'

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

  it('requires a return to neutral before another tilt', () => {
    const detector = createTiltDetector({ threshold: 20, neutralBand: 8, cooldownMs: 0 })
    detector.calibrate([0, 0, 0])
    expect(detector.read(25, 1)).toBe('correct')
    expect(detector.read(30, 2)).toBeNull()
    expect(detector.read(0, 3)).toBeNull()
    expect(detector.read(-25, 4)).toBe('passed')
  })
})
