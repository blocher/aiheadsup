import { describe, expect, it } from 'vitest'
import { TUTORIAL_SLIDES } from './tutorial-slides.js'

describe('tutorial slides', () => {
  it('defines eight slides with required fields', () => {
    expect(TUTORIAL_SLIDES).toHaveLength(8)
    for (const slide of TUTORIAL_SLIDES) {
      expect(slide.id).toEqual(expect.any(String))
      expect(slide.eyebrow).toEqual(expect.any(String))
      expect(slide.title).toEqual(expect.any(String))
      expect(slide.body.length).toBeGreaterThan(10)
      expect(slide.mockup).toEqual(expect.any(String))
      expect(slide.accent).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('gives every slide actionable instruction points', () => {
    for (const slide of TUTORIAL_SLIDES) {
      expect(Array.isArray(slide.points)).toBe(true)
      expect(slide.points.length).toBeGreaterThanOrEqual(2)
      for (const point of slide.points) {
        expect(point.length).toBeGreaterThan(5)
      }
    }
  })

  it('uses unique slide ids', () => {
    const ids = TUTORIAL_SLIDES.map((slide) => slide.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ends with a ready-to-play slide', () => {
    expect(TUTORIAL_SLIDES.at(-1).id).toBe('ready')
  })

  it('includes deck creation guidance', () => {
    expect(TUTORIAL_SLIDES.some((slide) => slide.id === 'make-deck')).toBe(true)
  })
})
