import { describe, expect, it, vi } from 'vitest'
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
    const result = await generateCustomPack(provider, { category: 'Space', audience: 'Family', difficulty: 'Easy', cardCount: 125 }, (update) => progress.push(update), { skipAccuracyReview: true })
    expect(result.cards).toHaveLength(125)
    expect(new Set(result.cards.map((card) => card.normalizedPrompt)).size).toBe(125)
    expect(requests).toEqual([50, 50, 25])
    expect(progress.at(-1)).toMatchObject({ batch: 3, totalBatches: 3, cardCount: 125, targetCardCount: 125 })
  })

  it('retries partial on-device batches until the target count is reached', async () => {
    let nextCard = 1
    const requests = []
    const provider = {
      generateCover: async () => new Blob(['cover']),
      generateCards: async ({ count }) => {
        requests.push(count)
        const batch = Math.min(count, 4)
        return Array.from({ length: batch }, () => ({ prompt: `Card ${nextCard++}` }))
      }
    }
    const result = await generateCustomPack(
      provider,
      { providerId: 'device', category: 'School', audience: 'Family', difficulty: 'Easy', cardCount: 10 },
      null,
      { skipAccuracyReview: true }
    )
    expect(result.cards).toHaveLength(10)
    expect(requests.length).toBeGreaterThan(1)
  })

  it('skips the slow accuracy-review pass for on-device generation by default', async () => {
    // The review pass would call the on-device model again (unavailable in this
    // environment) and log a warning on failure. No warning proves it was skipped.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let nextCard = 1
    const provider = {
      generateCover: async () => new Blob(['cover']),
      generateCards: async ({ count }) => Array.from({ length: count }, () => ({ prompt: `Card ${nextCard++}` }))
    }
    const result = await generateCustomPack(
      provider,
      { providerId: 'device', category: 'Space', audience: 'Family', difficulty: 'Easy', cardCount: 6 },
      null
    )
    expect(result.cards).toHaveLength(6)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('keeps a partial on-device deck when a later batch fails', async () => {
    let calls = 0
    const provider = {
      generateCover: async () => new Blob(['cover']),
      generateCards: async ({ count }) => {
        calls += 1
        if (calls >= 3) throw new Error('The deck request was too large for on-device Apple Intelligence.')
        return Array.from({ length: Math.min(count, 4) }, (_, index) => ({ prompt: `Card ${calls}-${index}` }))
      }
    }
    const result = await generateCustomPack(
      provider,
      { providerId: 'device', category: 'School', audience: 'Family', difficulty: 'Easy', cardCount: 20 },
      null
    )
    expect(result.cards.length).toBeGreaterThan(0)
    expect(result.partial).toBe(true)
  })

  it('rethrows when on-device generation fails before any cards are produced', async () => {
    const provider = {
      generateCover: async () => new Blob(['cover']),
      generateCards: async () => { throw new Error('model unavailable') }
    }
    await expect(generateCustomPack(
      provider,
      { providerId: 'device', category: 'School', audience: 'Family', difficulty: 'Easy', cardCount: 10 },
      null
    )).rejects.toThrow(/model unavailable/)
  })

  it('saves a partial deck when the target count cannot be reached', async () => {
    let nextCard = 1
    const provider = {
      generateCover: async () => new Blob(['cover']),
      generateCards: async () => {
        if (nextCard > 7) return []
        return [{ prompt: `Card ${nextCard++}` }]
      }
    }
    const result = await generateCustomPack(
      provider,
      { providerId: 'device', category: 'School', audience: 'Family', difficulty: 'Easy', cardCount: 10 },
      null,
      { skipAccuracyReview: true }
    )
    expect(result.partial).toBe(true)
    expect(result.requestedCardCount).toBe(10)
    expect(result.cards).toHaveLength(7)
  })
})
