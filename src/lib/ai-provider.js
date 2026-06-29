import { Capacitor, registerPlugin } from '@capacitor/core'
import { createId, normalizePrompt } from './ids.js'
import { getSpoilerSeries } from './spoiler-series.js'
import { coverPromptForDeck, generateCoverWithFallback } from './cover-prompts.js'
import { AI_PROVIDERS, DEFAULT_PROVIDER_ID, getProvider } from './ai-providers.js'
import { reviewDeckCards } from './card-accuracy.js'

const SecureAi = registerPlugin('SecureAi')

function isNative() { return Capacitor.isNativePlatform() }

function webKeyStorage(providerId) { return `forehead-frenzy.${providerId}-api-key` }

function readWebKey(providerId) {
  const key = localStorage.getItem(webKeyStorage(providerId))
  if (!key) throw new Error(`Add an ${getProvider(providerId)?.label || providerId} API key in Settings first.`)
  return key
}

async function geminiWeb({ model, prompt, wantsImage }) {
  const apiKey = readWebKey('gemini')
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

async function openaiWeb({ model, prompt, wantsImage }) {
  const apiKey = readWebKey('openai')
  const url = wantsImage ? 'https://api.openai.com/v1/images/generations' : 'https://api.openai.com/v1/chat/completions'
  const body = wantsImage
    ? { model, prompt, size: '1024x1536' }
    : { model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status}).`)
  if (wantsImage) {
    const image = payload.data?.[0]?.b64_json
    if (!image) throw new Error('OpenAI did not return an image.')
    return { base64: image, mimeType: 'image/png' }
  }
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI did not return text.')
  return { text }
}

function webGenerate({ providerId, model, prompt, wantsImage }) {
  if (providerId === 'openai') return openaiWeb({ model, prompt, wantsImage })
  return geminiWeb({ model, prompt, wantsImage })
}

async function requestText(providerId, model, prompt) {
  if (isNative()) return SecureAi.generateText({ provider: providerId, model, prompt })
  return webGenerate({ providerId, model, prompt, wantsImage: false })
}

async function requestImage(providerId, model, prompt) {
  const result = isNative()
    ? await SecureAi.generateImage({ provider: providerId, model, prompt })
    : await webGenerate({ providerId, model, prompt, wantsImage: true })
  if (!result?.base64) throw new Error('The AI provider did not return an image.')
  return result
}

export class AiProvider {
  async hasKey(providerId) {
    if (isNative()) return (await SecureAi.hasApiKey({ provider: providerId })).hasKey
    return Boolean(localStorage.getItem(webKeyStorage(providerId)))
  }

  async keyedProviderIds() {
    const flags = await Promise.all(AI_PROVIDERS.map((provider) => this.hasKey(provider.id)))
    return AI_PROVIDERS.filter((_, index) => flags[index]).map((provider) => provider.id)
  }

  async saveKey(providerId, apiKey) {
    if (isNative()) return SecureAi.saveApiKey({ provider: providerId, apiKey })
    localStorage.setItem(webKeyStorage(providerId), apiKey)
  }

  async removeKey(providerId) {
    if (isNative()) return SecureAi.removeApiKey({ provider: providerId })
    localStorage.removeItem(webKeyStorage(providerId))
  }

  async generateCards({ providerId = DEFAULT_PROVIDER_ID, name = '', category, audience, difficulty, count, excludedPrompts, spoilerSeries: requestedSpoilerSeries = '', harryPotterMode = false, specialPromptNote = '' }) {
    const meta = getProvider(providerId) || getProvider(DEFAULT_PROVIDER_ID)
    const subject = (name || category).trim()
    const exclusions = excludedPrompts.slice(-300).join(', ')
    const spoilerSeries = getSpoilerSeries(requestedSpoilerSeries || (harryPotterMode ? 'harry_potter' : ''))
    const schema = spoilerSeries ? '{"cards":[{"prompt":"item","earliestInstallment":1}]}' : '{"cards":[{"prompt":"item"}]}'
    const spoilerRule = spoilerSeries ? `For every card, set earliestInstallment to the earliest ${spoilerSeries.label} installment where that person, place, object, creature, spell, or concept is revealed. Use a whole number from 1 through ${spoilerSeries.installments.length}. The order is: ${spoilerSeries.installments.map((installment, index) => `${index + 1}=${installment}`).join('; ')}. ` : ''
    const prompt = `Create exactly ${count} unique Heads Up style guessing prompts for a deck titled "${subject}" (category: ${category}). Audience: ${audience}. Difficulty: ${difficulty}. Extra deck guidance: ${specialPromptNote || 'None.'} Return only JSON of the form ${schema}. Every prompt must be a simple, clueable person, place, thing, creature, spell, or title of 1 to 4 words that clearly fits "${subject}". No sentences, descriptions, hints, questions, variants, subtitles, or duplicated answers. ${spoilerRule}Do not reuse or closely restate these existing prompts: ${exclusions}`
    const { text } = await requestText(meta.id, meta.textModel, prompt)
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error('The AI returned an unreadable card batch. Please retry.') }
    const cards = Array.isArray(parsed.cards) ? parsed.cards : []
    return cards.map((card) => ({ prompt: typeof card === 'string' ? card : card?.prompt, earliestInstallment: spoilerSeries ? Number(card?.earliestInstallment ?? card?.earliestBook) : null }))
      .filter((card) => typeof card.prompt === 'string' && card.prompt.trim().split(/\s+/).length <= 4 && card.prompt.trim().length > 0 && (!spoilerSeries || Number.isInteger(card.earliestInstallment) && card.earliestInstallment >= 1 && card.earliestInstallment <= spoilerSeries.installments.length))
      .map((card) => ({ ...card, prompt: card.prompt.trim() }))
  }

  async generateCover({ providerId = DEFAULT_PROVIDER_ID, name = '', category, audience, difficulty }) {
    const meta = getProvider(providerId) || getProvider(DEFAULT_PROVIDER_ID)
    const result = await generateCoverWithFallback({
      getPromptInput: () => ({ name: (name || category).trim(), category, audience, difficulty }),
      requestImage: (prompt) => requestImage(meta.id, meta.imageModel, prompt)
    })
    const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
    return new Blob([bytes], { type: result.mimeType || 'image/png' })
  }
}

export function fallbackCover(category) {
  const safe = category.replace(/[<>&]/g, '')
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff5d8f"/><stop offset=".5" stop-color="#713fd4"/><stop offset="1" stop-color="#0fcbcc"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="650" cy="170" r="180" fill="#ffe663" opacity=".88"/><circle cx="130" cy="810" r="210" fill="#10152d" opacity=".28"/><path d="M120 670 Q400 350 680 670" fill="none" stroke="white" stroke-width="22" opacity=".65"/><text x="400" y="500" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="800" font-size="56">${safe.slice(0, 24)}</text></svg>`], { type: 'image/svg+xml' })
}

export async function generateCustomPack(provider, request, onProgress, { skipAccuracyReview = false } = {}) {
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
    if (!complete) throw new Error('The AI could not supply enough unique prompts. Nothing was saved; please retry.')
    onProgress?.({ phase: 'generating', batch, totalBatches, cardCount: prompts.length, targetCardCount })
  }
  const meta = getProvider(request.providerId) || getProvider(DEFAULT_PROVIDER_ID)
  if (!skipAccuracyReview) {
    const reviewedPrompts = await reviewDeckCards({
      cards: prompts,
      deckMeta: {
        name: (request.name || request.category).trim(),
        category: request.category.trim(),
        audience: request.audience,
        difficulty: request.difficulty,
        specialPromptNote: request.specialPromptNote?.trim() || '',
        spoilerSeries: request.spoilerSeries || (request.harryPotterMode ? 'harry_potter' : '')
      },
      requestReview: async (prompt) => {
        const { text } = await requestText(meta.id, meta.textModel, prompt)
        try { return JSON.parse(text) } catch { throw new Error('The AI returned an unreadable accuracy review.') }
      },
      onProgress: (update) => onProgress?.({ ...update, targetCardCount: prompts.length })
    })
    prompts.splice(0, prompts.length, ...reviewedPrompts)
  }
  await coverTask
  const id = createId('pack')
  return {
    pack: {
      id,
      title: (request.name || request.category).trim(),
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
