import { describe, expect, it } from 'vitest'
import { bundledTomlDecks, deckToToml, parseDeckToml } from './toml-decks.js'

describe('TOML decks', () => {
  it('loads every bundled TOML deck as a valid card deck', () => {
    expect(bundledTomlDecks.every((deck) => deck.cards.length > 0 && Boolean(deck.category))).toBe(true)
  })

  it('round-trips an AI deck with card spoiler metadata, including Cursed Child as Book 8', () => {
    const toml = deckToToml(
      { id: 'ai-space', title: 'Space Stuff', category: 'Science', audience: 'Family', difficulty: 'Easy', specialPromptNote: 'Use objects only.', spoilerMode: true },
      [{ prompt: 'Moon Base', earliestBook: 8 }],
      'space.png'
    )
    const deck = parseDeckToml(toml)
    expect(deck.category).toBe('Science')
    expect(deck.cards[0].earliestBook).toBe(8)
  })
})
