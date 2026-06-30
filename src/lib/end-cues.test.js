import { describe, expect, it } from 'vitest'
import { getCueVolume, setCueVolume } from './end-cues.js'

describe('cue volume', () => {
  it('clamps the volume multiplier to the 0-1 range', () => {
    expect(setCueVolume(0.5)).toBe(0.5)
    expect(getCueVolume()).toBe(0.5)
    expect(setCueVolume(2)).toBe(1)
    expect(setCueVolume(-1)).toBe(0)
  })

  it('falls back to full volume for invalid values', () => {
    expect(setCueVolume('not a number')).toBe(1)
    expect(setCueVolume(NaN)).toBe(1)
  })
})
