import { describe, expect, it } from 'vitest'
import { bundledDeckRecord, bundledTomlDecks, deckToToml, parseDeckToml } from './toml-decks.js'

function duplicateKey(prompt) {
  return prompt.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').map((word) => word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word).join(' ')
}

describe('TOML decks', () => {
  it('loads every bundled TOML deck as a valid card deck', () => {
    expect(bundledTomlDecks.every((deck) => deck.cards.length > 0 && Boolean(deck.category))).toBe(true)
  })

  it('has no duplicate cards, including singular/plural variants, within a deck', () => {
    for (const deck of bundledTomlDecks) {
      const keys = deck.cards.map((card) => duplicateKey(card.prompt))
      expect(new Set(keys).size, `Deck “${deck.title}” has duplicate prompts.`).toBe(keys.length)
    }
  })

  it('round-trips an AI deck with franchise-aware spoiler metadata', () => {
    const toml = deckToToml(
      { id: 'ai-space', title: 'Space Stuff', category: 'Science', audience: 'Family', difficulty: 'Easy', specialPromptNote: 'Use objects only.', spoilerMode: true, spoilerSeries: 'indiana_jones' },
      [{ prompt: 'Moon Base', earliestInstallment: 5 }],
      'space.png'
    )
    const deck = parseDeckToml(toml)
    expect(deck.category).toBe('Science')
    expect(deck.spoilerSeries).toBe('indiana_jones')
    expect(deck.cards[0].earliestInstallment).toBe(5)
  })

  it('changes a bundled deck signature whenever its cards change', () => {
    const original = parseDeckToml('id = "sample"\nname = "Sample"\ncategory = "Science"\ncards = [{ text = "Moon" }]')
    const edited = parseDeckToml('id = "sample"\nname = "Sample"\ncategory = "Science"\ncards = [{ text = "Mars" }]')
    expect(bundledDeckRecord(original).bundledContentSignature).not.toBe(bundledDeckRecord(edited).bundledContentSignature)
  })
})
