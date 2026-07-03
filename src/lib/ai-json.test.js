import { describe, expect, it } from 'vitest'
import { extractJsonText, normalizeCardBatch, parseAiCardBatch, parseAiJsonObject } from './ai-json.js'

describe('ai json parsing', () => {
  it('strips markdown fences', () => {
    expect(extractJsonText('```json\n{"cards":[{"prompt":"A"}]}\n```')).toBe('{"cards":[{"prompt":"A"}]}')
  })

  it('parses standard card batches', () => {
    expect(parseAiCardBatch('{"cards":[{"prompt":"Apple"},{"prompt":"Banana"}]}')).toEqual([
      { prompt: 'Apple' },
      { prompt: 'Banana' }
    ])
  })

  it('flattens array-of-single-card batches from on-device models', () => {
    const raw = '```json\n[{"cards":[{"prompt":"Bubbles"}]},{"cards":[{"prompt":"Clue"}]}]\n```'
    expect(parseAiCardBatch(raw)).toEqual([
      { prompt: 'Bubbles' },
      { prompt: 'Clue' }
    ])
  })

  it('salvages prompts from truncated responses', () => {
    const raw = '[{"cards":[{"prompt":"Bubbles"}]},{"cards":[{"prompt":"Clue"}]},{"cards":[{"prompt":"Exam"}'
    expect(parseAiCardBatch(raw).map((card) => card.prompt)).toEqual(['Bubbles', 'Clue', 'Exam'])
  })

  it('parses review objects with fences', () => {
    expect(parseAiJsonObject('```json\n{"remove":["bad"],"keep":["good"]}\n```')).toEqual({
      remove: ['bad'],
      keep: ['good']
    })
  })

  it('normalizes string arrays', () => {
    expect(normalizeCardBatch(['Apple', 'Banana'])).toEqual([
      { prompt: 'Apple' },
      { prompt: 'Banana' }
    ])
  })
})
