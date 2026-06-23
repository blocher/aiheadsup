import { describe, expect, it } from 'vitest'
import { buildDeckPackage, parseDeckPackages } from './deck-transfer.js'

describe('deck transfer', () => {
  it('round-trips a deck TOML and optional cover through a ZIP package', async () => {
    const pack = {
      id: 'ai_test_magic',
      title: 'Magic Things',
      category: 'Wizarding World',
      audience: 'Family',
      difficulty: 'Easy',
      specialPromptNote: 'Keep prompts short.',
      spoilerMode: true,
      cover: { kind: 'blob', value: new Blob(['image'], { type: 'image/png' }) }
    }
    const cards = [{ id: 'one', prompt: 'Golden Snitch', earliestBook: 1 }]
    const packageBlob = await buildDeckPackage(pack, cards)
    const [imported] = await parseDeckPackages({ arrayBuffer: () => packageBlob.arrayBuffer() })

    expect(imported.deck).toMatchObject({ id: pack.id, title: pack.title, category: pack.category, spoilerMode: true })
    expect(imported.deck.cards).toMatchObject([{ prompt: 'Golden Snitch', earliestBook: 1 }])
    expect(imported.cover?.value.type).toBe('image/png')
  })
})
