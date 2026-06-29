import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cardPrompt, coverPrompt, generateCards, generateCover, parseArguments, planDeckWork, readDefinitions, validateCards } from '../../scripts/generate-decks.mjs'

const source = `decks = [
  { name = "Gaga Ball", category = "Sports", difficulty = "easy", target = "family", number_of_cards = "100", special_instructions = "Use playground terms.", include_harry_potter_book_number = false },
  { name = "Cursed Child", category = "Harry Potter", difficulty = "hard", target = "teens+", number_of_cards = "", special_instructions = "Use play details.", spoiler_series = "harry_potter" }
]`

describe('deck generation CLI', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => { globalThis.fetch = originalFetch })
  it('reads special instructions and defaults blank card counts', () => {
    const [gaga, cursed] = readDefinitions(source, 20)
    expect(gaga).toMatchObject({ target: 'Family', numberOfCards: 100, specialInstructions: 'Use playground terms.' })
    expect(cursed).toMatchObject({ target: 'Teens+', numberOfCards: 20, specialInstructions: 'Use play details.', spoilerSeries: 'harry_potter' })
  })

  it('builds the spoiler-aware prompt and removes invalid cards', () => {
    const [, deck] = readDefinitions(source)
    expect(cardPrompt(deck, 2)).toContain('Cursed Child')
    expect(validateCards({ cards: [{ prompt: 'Delphi', earliest_installment: 8 }, { prompt: 'A phrase with five words', earliest_installment: 8 }, { prompt: 'Delphi', earliest_installment: 8 }] }, deck)).toEqual([{ prompt: 'Delphi', earliestInstallment: 8 }])
  })

  it('asks generated covers to use the full image without text or banner space', () => {
    const [deck] = readDefinitions(source)
    expect(coverPrompt(deck)).toContain('full-bleed composition')
    expect(coverPrompt(deck)).toContain('Do not include text')
    expect(coverPrompt(deck)).toContain('empty space at the top')
  })

  it('uses an original generic space-adventure brief for Star Wars covers', () => {
    const starWarsDeck = { ...readDefinitions(source)[0], name: 'Star Wars Episode IV: A New Hope', category: 'Star Wars' }
    const prompt = coverPrompt(starWarsDeck)
    expect(prompt).toContain('family-friendly galactic adventure')
    expect(prompt).not.toMatch(/star wars|episode|new hope/i)
  })

  it('retries a failed cover up to four times, then continues without one', async () => {
    const [deck] = readDefinitions(source)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) })
    await expect(generateCover('test-key', deck, { imageModel: 'test-model' })).resolves.toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('Continuing without a cover'))
    warn.mockRestore()
  })

  it('switches to a generic prompt after a copyright rejection', async () => {
    const [deck] = readDefinitions(source)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Blocked for copyright reasons' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('abc').toString('base64'), mimeType: 'image/png' } }] } }] }) })
    const cover = await generateCover('test-key', deck, { imageModel: 'test-model' })
    expect(cover?.bytes.toString()).toBe('abc')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(String(globalThis.fetch.mock.calls[1][1].body)).toContain('generic visuals')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('generic non-copyrighted cover prompt'))
    warn.mockRestore()
  })

  it('supports the requested testing flags', () => {
    expect(parseArguments(['--limit', '2', '--images', '--dry-run'])).toMatchObject({ limit: 2, images: true, dryRun: true })
  })

  it('defaults models per provider and rejects unknown providers', () => {
    expect(parseArguments([])).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash', imageModel: 'gemini-3.1-flash-image' })
    expect(parseArguments(['--provider', 'openai'])).toMatchObject({ provider: 'openai', model: 'gpt-5.5', imageModel: 'gpt-image-2' })
    expect(parseArguments(['--provider', 'openai', '--model', 'gpt-custom'])).toMatchObject({ provider: 'openai', model: 'gpt-custom' })
    expect(() => parseArguments(['--provider', 'claude'])).toThrow(/provider/)
  })

  it('generates cards through the OpenAI chat completions endpoint', async () => {
    const [deck] = readDefinitions(source)
    deck.numberOfCards = 1
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"cards":[{"prompt":"Gaga Pit"}]}' } }] }) })
    const cards = await generateCards('sk-test', deck, { provider: 'openai', model: 'gpt-4o-mini', batchSize: 1 })
    expect(cards).toEqual([{ prompt: 'Gaga Pit', earliestInstallment: null }])
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test')
  })

  it('generates covers through the OpenAI images endpoint', async () => {
    const [deck] = readDefinitions(source)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }) })
    const cover = await generateCover('sk-test', deck, { provider: 'openai', imageModel: 'gpt-image-1' })
    expect(cover).toMatchObject({ extension: 'png' })
    expect(cover.bytes.toString()).toBe('img')
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations')
  })

  it('skips existing TOMLs and only plans a missing requested cover', async () => {
    const [deck] = readDefinitions(source)
    const directory = await mkdtemp(path.join(os.tmpdir(), 'forehead-frenzy-'))
    const options = { output: path.join(directory, 'decks'), covers: path.join(directory, 'covers'), images: true, force: false }
    await mkdir(options.output, { recursive: true })
    await writeFile(path.join(options.output, `${deck.fileStem}.toml`), `id = "${deck.id}"\nname = "${deck.name}"\ncategory = "${deck.category}"\ncards = ["Gaga Ball"]\n`)
    await expect(planDeckWork(deck, options)).resolves.toMatchObject({ generateCards: false, generateImage: true })
    await mkdir(options.covers, { recursive: true })
    await writeFile(path.join(options.covers, `${deck.fileStem}-cover.png`), 'cover')
    await expect(planDeckWork(deck, options)).resolves.toMatchObject({ generateCards: false, generateImage: false, updateToml: true })
    await expect(planDeckWork(deck, { ...options, images: false })).resolves.toMatchObject({ generateCards: false, generateImage: false, updateToml: false })
  })

  it('keeps a partial card batch and warns instead of failing the deck', async () => {
    const [deck] = readDefinitions(source)
    deck.numberOfCards = 4
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"cards":[{"prompt":"Gaga Pit"}]}' }] } }] }) })
    const cards = await generateCards('test-key', deck, { model: 'test-model', batchSize: 4 })
    expect(cards).toEqual([{ prompt: 'Gaga Pit', earliestInstallment: null }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Saving the partial deck'))
    warn.mockRestore()
  })

  it('retries invalid JSON three times, then returns the available cards', async () => {
    const [deck] = readDefinitions(source)
    deck.numberOfCards = 1
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }) })
    await expect(generateCards('test-key', deck, { model: 'test-model', batchSize: 1 })).resolves.toEqual([])
    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid JSON three times'))
    warn.mockRestore()
  })
})
