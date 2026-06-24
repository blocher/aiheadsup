import { describe, expect, it } from 'vitest'
import { generateCustomPack } from './ai-provider.js'

describe('custom pack generation', () => {
  it('creates the requested locally validated card count in correctly sized batches', async () => {
    let nextCard = 1
    const requests = []
    const progress = []
    const provider = {
      generateCover: async () => new Blob(['cover']),
      generateCards: async ({ count }) => {
        requests.push(count)
        return Array.from({ length: count }, () => ({ prompt: `Card ${nextCard++}` }))
      }
    }
    const result = await generateCustomPack(provider, { category: 'Space', audience: 'Family', difficulty: 'Easy', cardCount: 125 }, (update) => progress.push(update))
    expect(result.cards).toHaveLength(125)
    expect(new Set(result.cards.map((card) => card.normalizedPrompt)).size).toBe(125)
    expect(requests).toEqual([50, 50, 25])
    expect(progress.at(-1)).toMatchObject({ batch: 3, totalBatches: 3, cardCount: 125, targetCardCount: 125 })
  })
})
