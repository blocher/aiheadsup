import { describe, expect, it, vi } from 'vitest'
import { accuracyReviewPrompt, dedupeReviewedCards, duplicateKey, parseReviewedCards, reviewDeckCards } from './card-accuracy.js'

describe('card accuracy review', () => {
  const deckMeta = {
    name: 'Pittsburgh Pirates',
    category: 'Sports',
    audience: 'Family',
    difficulty: 'Medium',
    specialInstructions: 'Use team traditions and baseball terms.',
    spoilerSeries: ''
  }

  it('builds a strict review prompt with deck context', () => {
    const prompt = accuracyReviewPrompt(deckMeta, [{ prompt: 'Pierogi Race' }, { prompt: 'Fred Rogers' }])
    expect(prompt).toContain('Pittsburgh Pirates')
    expect(prompt).toContain('hallucinated')
    expect(prompt).toContain('1. Pierogi Race')
    expect(prompt).toContain('2. Fred Rogers')
  })

  it('parses reviewed cards and rejects invalid entries', () => {
    const spoilerMeta = { ...deckMeta, spoilerSeries: 'harry_potter' }
    expect(parseReviewedCards({ cards: [{ prompt: 'Delphi', earliest_installment: 8 }, { prompt: 'A phrase with five words here', earliest_installment: 1 }, { prompt: 'Delphi', earliest_installment: 8 }] }, spoilerMeta))
      .toEqual([{ prompt: 'Delphi', earliestInstallment: 8 }])
  })

  it('dedupes singular and plural variants', () => {
    expect(dedupeReviewedCards([
      { prompt: 'Goal Posts', earliestInstallment: null },
      { prompt: 'Goal Post', earliestInstallment: null }
    ])).toEqual([{ prompt: 'Goal Posts', earliestInstallment: null }])
    expect(duplicateKey('Goal Posts')).toBe(duplicateKey('Goal Post'))
  })

  it('keeps original cards when review requests fail', async () => {
    const requestReview = vi.fn().mockRejectedValue(new Error('bad json'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cards = [{ prompt: 'Bucco', earliestInstallment: null }]
    await expect(reviewDeckCards({ cards, deckMeta, requestReview, batchSize: 50 })).resolves.toEqual(cards)
    expect(requestReview).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('reviews cards in batches and reports progress', async () => {
    const requestReview = vi.fn()
      .mockResolvedValueOnce({ cards: [{ prompt: 'Card 1' }] })
      .mockResolvedValueOnce({ cards: [{ prompt: 'Card 2' }] })
    const progress = []
    const cards = [{ prompt: 'Card 1' }, { prompt: 'Card 2' }]
    await expect(reviewDeckCards({
      cards,
      deckMeta,
      requestReview,
      batchSize: 1,
      onProgress: (update) => progress.push(update)
    })).resolves.toEqual([{ prompt: 'Card 1', earliestInstallment: null }, { prompt: 'Card 2', earliestInstallment: null }])
    expect(requestReview).toHaveBeenCalledTimes(2)
    expect(progress.at(-1)).toMatchObject({ phase: 'reviewing', chunk: 2, chunkCount: 2, reviewedCount: 2 })
  })
})
