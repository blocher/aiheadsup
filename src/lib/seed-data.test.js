import { describe, expect, it } from 'vitest'
import { seedPacks } from './seed-data.js'

describe('seeded Harry Potter packs', () => {
  it('contains only short, clueable cards with spoiler metadata', () => {
    const cards = seedPacks.flatMap((pack) => pack.cards)
    expect(cards.length).toBeGreaterThan(300)
    expect(cards.every((card) => card.prompt.trim().split(/\s+/).length <= 4)).toBe(true)
    expect(cards.every((card) => Number.isInteger(card.earliestBook) && card.earliestBook >= 1 && card.earliestBook <= 7)).toBe(true)
  })
})
