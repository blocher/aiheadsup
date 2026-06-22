import { describe, expect, it } from 'vitest'
import { generateCustomPack } from './ai-provider.js'

describe('custom pack generation', () => {
  it('creates 350 locally validated cards in seven batches', async () => {
    let call = 0
    const provider = {
      generateCover: async () => new Blob(['cover']),
      generateCards: async () => Array.from({ length: 50 }, (_, index) => ({ prompt: `Card ${call * 50 + index + 1}` }))
    }
    const result = await generateCustomPack(provider, { category: 'Space', audience: 'Family', difficulty: 'Easy' }, () => { call += 1 })
    expect(result.cards).toHaveLength(350)
    expect(new Set(result.cards.map((card) => card.normalizedPrompt)).size).toBe(350)
  })
})
