import { describe, expect, it, vi } from 'vitest'
import { coverPromptForDeck, generateCoverWithFallback, genericCoverPrompt, isCopyrightRelatedImageError } from './cover-prompts.js'

describe('cover prompts', () => {
  it('detects copyright-related image errors', () => {
    expect(isCopyrightRelatedImageError(new Error('Request blocked for copyright reasons'))).toBe(true)
    expect(isCopyrightRelatedImageError(new Error('Trademark policy violation'))).toBe(true)
    expect(isCopyrightRelatedImageError(new Error('Network timeout'))).toBe(false)
  })

  it('builds franchise-safe primary prompts for protected categories', () => {
    const starWars = coverPromptForDeck({ name: 'Episode IV', category: 'Star Wars', audience: 'Family', difficulty: 'Medium' })
    expect(starWars).toContain('galactic adventure')
    expect(starWars).not.toMatch(/episode|star wars/i)

    const harryPotter = coverPromptForDeck({ name: 'Book 1', category: 'Harry Potter', audience: 'Family', difficulty: 'Medium' })
    expect(harryPotter).toContain('magical boarding-school adventure')
    expect(harryPotter).not.toMatch(/harry potter|sorcerer/i)
  })

  it('protects specific copyrighted deck names regardless of category', () => {
    const prompt = coverPromptForDeck({ name: 'Mickey Mouse Clubhouse', category: 'TV Shows', audience: 'Family', difficulty: 'Easy' })
    expect(prompt).toContain('cartoon clubhouse adventure')
    expect(prompt).not.toMatch(/mickey|mouse|disney/i)
  })

  it('builds generic fallback prompts without deck names or franchise terms', () => {
    const prompt = genericCoverPrompt({ category: 'Harry Potter', audience: 'Family', difficulty: 'Hard' })
    expect(prompt).toContain('enchanted castles')
    expect(prompt).not.toMatch(/harry potter|hogwarts|dumbledore/i)
    expect(prompt).toContain('generic visuals')
  })

  it('retries with a generic prompt after a copyright rejection', async () => {
    const requestImage = vi.fn()
      .mockRejectedValueOnce(new Error('Blocked due to copyright'))
      .mockResolvedValueOnce({ base64: 'abc' })

    const result = await generateCoverWithFallback({
      getPromptInput: () => ({ name: 'Harry Potter Book 1', category: 'Harry Potter', audience: 'Family', difficulty: 'Medium' }),
      requestImage
    })

    expect(result).toEqual({ base64: 'abc' })
    expect(requestImage).toHaveBeenCalledTimes(2)
    expect(requestImage.mock.calls[0][0]).toContain('magical boarding-school adventure')
    expect(requestImage.mock.calls[1][0]).toContain('generic visuals')
    expect(requestImage.mock.calls[1][0]).not.toMatch(/harry potter book 1/i)
  })
})
