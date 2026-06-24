import { describe, expect, it } from 'vitest'
import { defaultSpoilerLimits, spoilerSeries } from './spoiler-series.js'

describe('spoiler series', () => {
  it('keeps Star Wars in release order, including the two other films', () => {
    expect(spoilerSeries.star_wars.installments).toEqual([
      'Release 1 — Episode IV: A New Hope',
      'Release 2 — Episode V: The Empire Strikes Back',
      'Release 3 — Episode VI: Return of the Jedi',
      'Release 4 — Episode I: The Phantom Menace',
      'Release 5 — Episode II: Attack of the Clones',
      'Release 6 — Episode III: Revenge of the Sith',
      'Release 7 — Episode VII: The Force Awakens',
      'Release 8 — Rogue One',
      'Release 9 — Episode VIII: The Last Jedi',
      'Release 10 — Solo',
      'Release 11 — Episode IX: The Rise of Skywalker',
      'Release 12 — The Mandalorian',
      'Release 13 — General lore / all included stories'
    ])
  })

  it('defaults each series to its most useful safe limit', () => {
    expect(defaultSpoilerLimits()).toEqual({ harry_potter: 7, indiana_jones: 5, star_wars: 13 })
  })
})
