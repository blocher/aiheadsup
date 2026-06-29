import { Capacitor, registerPlugin } from '@capacitor/core'
import { createId, normalizePrompt } from './ids.js'
import { getSpoilerSeries } from './spoiler-series.js'

const SecureGemini = registerPlugin('SecureGemini')
const TEXT_MODEL = 'gemini-3.5-flash'
const IMAGE_MODEL = 'gemini-3.1-flash-image'
const WEB_KEY_STORAGE = 'forehead-frenzy.gemini-api-key'

function isNative() { return Capacitor.isNativePlatform() }

async function webGenerate({ model, prompt, wantsImage }) {
  const apiKey = localStorage.getItem(WEB_KEY_STORAGE)
  if (!apiKey) throw new Error('Add a Gemini API key in Settings first.')
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(wantsImage ? {} : { generationConfig: { responseMimeType: 'application/json' } })
    })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || `Gemini request failed (${response.status}).`)
  const parts = payload.candidates?.[0]?.content?.parts ?? []
  if (wantsImage) {
    const image = parts.find((part) => part.inlineData)?.inlineData
    if (!image?.data) throw new Error('Gemini did not return an image.')
    return { base64: image.data, mimeType: image.mimeType || 'image/png' }
  }
  const text = parts.map((part) => part.text).filter(Boolean).join('\n')
  if (!text) throw new Error('Gemini did not return text.')
  return { text }
}

export class GeminiProvider {
  async hasKey() { return isNative() ? (await SecureGemini.hasApiKey()).hasKey : Boolean(localStorage.getItem(WEB_KEY_STORAGE)) }
  async saveKey(apiKey) {
    if (isNative()) return SecureGemini.saveApiKey({ apiKey })
    localStorage.setItem(WEB_KEY_STORAGE, apiKey)
  }
  async removeKey() {
    if (isNative()) return SecureGemini.removeApiKey()
    localStorage.removeItem(WEB_KEY_STORAGE)
  }

  async generateCards({ category, audience, difficulty, count, excludedPrompts, spoilerSeries: requestedSpoilerSeries = '', harryPotterMode = false, specialPromptNote = '' }) {
    const exclusions = excludedPrompts.slice(-300).join(', ')
    const spoilerSeries = getSpoilerSeries(requestedSpoilerSeries || (harryPotterMode ? 'harry_potter' : ''))
    const schema = spoilerSeries ? '{"cards":[{"prompt":"item","earliestInstallment":1}]}' : '{"cards":[{"prompt":"item"}]}'
    const spoilerRule = spoilerSeries ? `For every card, set earliestInstallment to the earliest ${spoilerSeries.label} installment where that person, place, object, creature, spell, or concept is revealed. Use a whole number from 1 through ${spoilerSeries.installments.length}. The order is: ${spoilerSeries.installments.map((installment, index) => `${index + 1}=${installment}`).join('; ')}. ` : ''
    const prompt = `Create exactly ${count} unique Heads Up style guessing prompts for the category "${category}". Audience: ${audience}. Difficulty: ${difficulty}. Extra deck guidance: ${specialPromptNote || 'None.'} Return only JSON of the form ${schema}. Every prompt must be a simple, clueable person, place, thing, creature, spell, or title of 1 to 4 words. No sentences, descriptions, hints, questions, variants, subtitles, or duplicated answers. ${spoilerRule}Do not reuse or closely restate these existing prompts: ${exclusions}`
    const { text } = isNative() ? await SecureGemini.generateText({ model: TEXT_MODEL, prompt }) : await webGenerate({ model: TEXT_MODEL, prompt, wantsImage: false })
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error('Gemini returned an unreadable card batch. Please retry.') }
    const cards = Array.isArray(parsed.cards) ? parsed.cards : []
    return cards.map((card) => ({ prompt: typeof card === 'string' ? card : card?.prompt, earliestInstallment: spoilerSeries ? Number(card?.earliestInstallment ?? card?.earliestBook) : null }))
      .filter((card) => typeof card.prompt === 'string' && card.prompt.trim().split(/\s+/).length <= 4 && card.prompt.trim().length > 0 && (!spoilerSeries || Number.isInteger(card.earliestInstallment) && card.earliestInstallment >= 1 && card.earliestInstallment <= spoilerSeries.installments.length))
      .map((card) => ({ ...card, prompt: card.prompt.trim() }))
  }

  async generateCover({ category, audience, difficulty }) {
    const isSpaceOpera = category === 'Star Wars'
    const subject = isSpaceOpera
      ? 'an original family-friendly galactic adventure with space explorers, imaginative spacecraft, an alien world, and a dramatic cosmic landscape'
      : `"${category}"`
    const originalityRule = isSpaceOpera
      ? 'Use no recognizable franchise-specific people, costumes, vehicles, symbols, locations, or story elements. '
      : ''
    const prompt = `Create an original vertical 4:5 illustrated party-game deck cover for ${subject}. Audience ${audience}; difficulty ${difficulty}. Bold, joyful, high-contrast, readable as a small tile, magical only when appropriate to the category. Use a full-bleed composition that fills the entire image edge to edge. Do not include text, lettering, logos, watermarks, banners, title areas, frames, or empty space at the top. ${originalityRule}No copyrighted characters, actor likenesses, or branded symbols.`
    const result = isNative() ? await SecureGemini.generateImage({ model: IMAGE_MODEL, prompt }) : await webGenerate({ model: IMAGE_MODEL, prompt, wantsImage: true })
    const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
    return new Blob([bytes], { type: result.mimeType || 'image/png' })
  }
}

export function fallbackCover(category) {
  const safe = category.replace(/[<>&]/g, '')
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff5d8f"/><stop offset=".5" stop-color="#713fd4"/><stop offset="1" stop-color="#0fcbcc"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="650" cy="170" r="180" fill="#ffe663" opacity=".88"/><circle cx="130" cy="810" r="210" fill="#10152d" opacity=".28"/><path d="M120 670 Q400 350 680 670" fill="none" stroke="white" stroke-width="22" opacity=".65"/><text x="400" y="500" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="800" font-size="56">${safe.slice(0, 24)}</text></svg>`], { type: 'image/svg+xml' })
}

export async function generateCustomPack(provider, request, onProgress) {
  const targetCardCount = Number(request.cardCount ?? 100)
  if (!Number.isInteger(targetCardCount) || targetCardCount < 1 || targetCardCount > 350) throw new Error('Choose between 1 and 350 cards.')
  const totalBatches = Math.ceil(targetCardCount / 50)
  const prompts = []
  let cover = null
  const coverTask = provider.generateCover(request).then((result) => { cover = result }).catch(() => { cover = fallbackCover(request.category) })
  for (let batch = 1; batch <= totalBatches; batch += 1) {
    const batchTarget = Math.min(50, targetCardCount - prompts.length)
    const batchStart = prompts.length
    let complete = false
    for (let attempt = 0; attempt < 4 && !complete; attempt += 1) {
      const stillNeeded = batchTarget - (prompts.length - batchStart)
      const batchCards = await provider.generateCards({ ...request, count: stillNeeded, excludedPrompts: prompts.map((card) => card.prompt) })
      const unique = batchCards.filter((card) => !prompts.some((saved) => normalizePrompt(saved.prompt) === normalizePrompt(card.prompt)))
      prompts.push(...unique.slice(0, stillNeeded))
      if (prompts.length - batchStart === batchTarget) complete = true
    }
    if (!complete) throw new Error('Gemini could not supply enough unique prompts. Nothing was saved; please retry.')
    onProgress?.({ batch, totalBatches, cardCount: prompts.length, targetCardCount })
  }
  await coverTask
  const id = createId('pack')
  return {
    pack: {
      id,
      title: request.category.trim(),
      category: request.category.trim(),
      audience: request.audience,
      difficulty: request.difficulty,
      specialPromptNote: request.specialPromptNote?.trim() || '',
      source: 'ai',
      isAiGenerated: true,
      spoilerMode: Boolean(request.spoilerSeries || request.harryPotterMode),
      spoilerSeries: request.spoilerSeries || (request.harryPotterMode ? 'harry_potter' : null),
      cover: { kind: 'blob', value: cover },
      createdAt: new Date().toISOString()
    },
    cards: prompts.map((card) => ({ id: createId('card'), prompt: card.prompt, normalizedPrompt: normalizePrompt(card.prompt), earliestInstallment: card.earliestInstallment, firstShownAt: null }))
  }
}
