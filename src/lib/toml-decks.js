import { parse, stringify } from 'smol-toml'
import { normalizePrompt } from './ids.js'
import { getSpoilerSeries } from './spoiler-series.js'

const rawDecks = import.meta.glob('../decks/*.toml', { eager: true, query: '?raw', import: 'default' })

function assertDeck(raw) {
  if (!raw.id || !raw.name || !raw.category) throw new Error('A deck TOML file needs id, name, and category.')
  if (!Array.isArray(raw.cards) || !raw.cards.length) throw new Error(`Deck “${raw.name}” needs at least one card.`)
  const spoilerSeries = String(raw.spoiler_series || '').trim() || (raw.spoiler_mode ? 'harry_potter' : '')
  const series = getSpoilerSeries(spoilerSeries)
  if (raw.spoiler_mode && !series) throw new Error(`Deck “${raw.name}” has an unknown spoiler series.`)
  const cards = raw.cards.map((card) => {
    const text = typeof card === 'string' ? card : card.text
    const earliestInstallment = typeof card === 'string' ? null : card.first_revealed_installment ?? card.first_revealed_book
    if (!text || text.trim().split(/\s+/).length > 4) throw new Error(`Deck “${raw.name}” has an invalid card: ${text || '(blank)'}`)
    if (raw.spoiler_mode && (!Number.isInteger(earliestInstallment) || earliestInstallment < 1 || earliestInstallment > series.installments.length)) throw new Error(`Deck “${raw.name}” needs a valid first_revealed_installment for every card.`)
    return { id: `${raw.id}_${normalizePrompt(text).replaceAll(' ', '-')}`, prompt: text.trim(), normalizedPrompt: normalizePrompt(text), earliestInstallment: earliestInstallment ?? null, firstShownAt: null }
  })
  return {
    id: raw.id,
    revision: Number(raw.revision || 1),
    title: raw.name,
    category: raw.category,
    audience: raw.audience || 'Family',
    difficulty: raw.difficulty || 'Easy',
    specialPromptNote: raw.special_prompt_note || '',
    spoilerMode: Boolean(raw.spoiler_mode),
    spoilerSeries: spoilerSeries || null,
    photoFileName: raw.photo_file_name || null,
    cards
  }
}

export function parseDeckToml(source) {
  return assertDeck(parse(source))
}

export const bundledTomlDecks = Object.values(rawDecks).map(parseDeckToml)

function bundledContentSignature(deck) {
  return JSON.stringify({
    id: deck.id,
    revision: deck.revision,
    title: deck.title,
    category: deck.category,
    audience: deck.audience,
    difficulty: deck.difficulty,
    specialPromptNote: deck.specialPromptNote,
    spoilerMode: deck.spoilerMode,
    spoilerSeries: deck.spoilerSeries,
    photoFileName: deck.photoFileName,
    cards: deck.cards.map(({ id, prompt, normalizedPrompt, earliestInstallment }) => ({ id, prompt, normalizedPrompt, earliestInstallment }))
  })
}

export function bundledDeckRecord(deck) {
  return {
    id: deck.id,
    title: deck.title,
    category: deck.category,
    audience: deck.audience,
    difficulty: deck.difficulty,
    specialPromptNote: deck.specialPromptNote,
    spoilerMode: deck.spoilerMode,
    spoilerSeries: deck.spoilerSeries,
    bundledContentSignature: bundledContentSignature(deck),
    source: 'bundled_toml',
    isAiGenerated: false,
    revision: deck.revision,
    cover: deck.photoFileName ? { kind: 'asset', value: `/covers/${deck.photoFileName}` } : null,
    createdAt: '2026-06-22T00:00:00.000Z'
  }
}

export function deckToToml(pack, cards, photoFileName = null) {
  const serializable = {
    id: pack.id,
    revision: 1,
    name: pack.title,
    category: pack.category,
    audience: pack.audience,
    difficulty: pack.difficulty,
    special_prompt_note: pack.specialPromptNote || '',
    ...(photoFileName ? { photo_file_name: photoFileName } : {}),
    spoiler_mode: Boolean(pack.spoilerMode),
    ...(pack.spoilerMode ? { spoiler_series: pack.spoilerSeries || 'harry_potter' } : {}),
    cards: cards.map((card) => ({ text: card.prompt, ...(pack.spoilerMode ? { first_revealed_installment: card.earliestInstallment ?? card.earliestBook } : {}) }))
  }
  return stringify(serializable)
}
