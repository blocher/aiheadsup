import { Capacitor, registerPlugin } from '@capacitor/core'
import { createId, normalizePrompt } from './ids.js'
import { getSpoilerSeries } from './spoiler-series.js'
import { coverPromptForDeck, deviceCoverConcept, generateCoverWithFallback } from './cover-prompts.js'
import {
  AI_PROVIDERS,
  CLOUD_AI_PROVIDERS,
  DEFAULT_CLOUD_PROVIDER_ID,
  DEFAULT_PROVIDER_ID,
  DEVICE_PROVIDER_ID,
  getProvider,
  isCloudProviderId,
  isDeviceProviderId
} from './ai-providers.js'
import {
  generateDeviceImage,
  getDeviceAiStatus,
  getDeviceBatchSize,
  getDeviceMaxOutputTokens,
  promptDevice,
  warmupDeviceSession
} from './local-llm.js'
import { parseAiCardBatch, parseAiJsonObject } from './ai-json.js'
import { reviewDeckCards } from './card-accuracy.js'

const SecureAi = registerPlugin('SecureAi')
const DEVICE_SESSION_ID = 'forehead-frenzy-deck-gen'
const DEVICE_INSTRUCTIONS = 'You write Heads Up guessing-game card prompts. Reply with raw JSON only — no markdown fences, no commentary, no code blocks. Use exactly this shape: {"cards":[{"prompt":"Example"}]}. Put every card in one cards array.'

export function warmupDeviceDeckSession() {
  return warmupDeviceSession({ sessionId: DEVICE_SESSION_ID, promptPrefix: DEVICE_INSTRUCTIONS })
}

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

async function requestDeviceText(prompt) {
  // Deliberately omit sessionId so each batch runs in a fresh, transient
  // session. Reusing one session across the many batch/retry calls made for a
  // single deck lets the transcript (prompt + JSON response + growing exclusion
  // list) accumulate until it overflows Apple Intelligence's context window,
  // which surfaces as a "deck request was too large" error mid-generation.
  return promptDevice({
    instructions: DEVICE_INSTRUCTIONS,
    prompt,
    maximumOutputTokens: getDeviceMaxOutputTokens()
  })
}

async function requestText(providerId, model, prompt) {
  if (isDeviceProviderId(providerId)) return { text: await requestDeviceText(prompt) }
  if (isNative()) return SecureAi.generateText({ provider: providerId, model, prompt })
  return webGenerate({ providerId, model, prompt, wantsImage: false })
}

async function requestImage(providerId, model, prompt) {
  if (isDeviceProviderId(providerId)) {
    if (Capacitor.getPlatform() === 'ios') {
      try {
        return await generateDeviceImage(prompt)
      } catch {
        throw new Error('On-device cover art failed.')
      }
    }
    throw new Error('On-device cover art is not available on this platform.')
  }
  const result = isNative()
    ? await SecureAi.generateImage({ provider: providerId, model, prompt })
    : await webGenerate({ providerId, model, prompt, wantsImage: true })
  if (!result?.base64) throw new Error('The AI provider did not return an image.')
  return result
}

export function generationBatchSize(providerId) {
  return isDeviceProviderId(providerId) ? getDeviceBatchSize() : 50
}

export function generationBatchAttempts(providerId) {
  return isDeviceProviderId(providerId) ? 12 : 4
}

function trimPromptToWords(prompt, maxWords = 4) {
  const words = prompt.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, maxWords).join(' ')
}

function sanitizeGeneratedCard(card, spoilerSeries) {
  const raw = typeof card === 'string' ? card : card?.prompt
  if (typeof raw !== 'string') return null
  const prompt = trimPromptToWords(raw)
  if (!prompt) return null
  if (!spoilerSeries) return { prompt, earliestInstallment: null }
  let earliestInstallment = Number(card?.earliestInstallment ?? card?.earliestBook)
  if (!Number.isInteger(earliestInstallment) || earliestInstallment < 1 || earliestInstallment > spoilerSeries.installments.length) {
    earliestInstallment = 1
  }
  return { prompt, earliestInstallment }
}

function addUniqueCards(prompts, batchCards, maxAdd) {
  const seen = new Set(prompts.map((card) => normalizePrompt(card.prompt)))
  let added = 0
  for (const card of batchCards) {
    if (added >= maxAdd) break
    const normalized = normalizePrompt(card.prompt)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    prompts.push(card)
    added += 1
  }
  return added
}

function requestCountForBatch({ stillNeeded, providerId, attempt, batchSize }) {
  if (!isDeviceProviderId(providerId)) return stillNeeded
  if (attempt >= 6) return Math.max(2, Math.ceil(stillNeeded / 2))
  return Math.min(stillNeeded + 4, batchSize)
}

// Errors that won't improve by retrying: the model can't run, refused on
// safety grounds, or the request overflowed its context. Everything else
// (empty/garbled output, transient failures) is worth another quick attempt.
const NON_RETRYABLE_DEVICE_KINDS = new Set(['model-unavailable', 'guardrail', 'context'])

function isRetryableDeviceError(error) {
  return !NON_RETRYABLE_DEVICE_KINDS.has(error?.kind)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fillCardTarget({ provider, request, targetCount, batchSize, onBatchComplete }) {
  const prompts = []
  const isDevice = isDeviceProviderId(request.providerId)
  const maxAttempts = generationBatchAttempts(request.providerId)
  const totalBatches = Math.ceil(targetCount / batchSize)
  let stopEarly = false

  const maxTries = isDevice ? 3 : 1
  const runBatch = async (count) => {
    let lastError
    for (let attempt = 0; attempt < maxTries; attempt += 1) {
      try {
        return await provider.generateCards({
          ...request,
          count,
          excludedPrompts: prompts.map((card) => card.prompt)
        })
      } catch (error) {
        lastError = error
        // Fatal on-device errors (model unavailable, guardrail, context) won't
        // improve on retry, so stop looping immediately and let the logic below
        // rethrow — this keeps the cloud fallback fast.
        if (!isDevice || !isRetryableDeviceError(error)) break
        if (attempt < maxTries - 1) await sleep(150 * (attempt + 1))
      }
    }
    // Once we already have usable cards, tolerate a failed round by stopping and
    // keeping the partial deck. With no cards yet, rethrow so the caller can fall
    // back to a cloud provider or show a real error.
    if (prompts.length > 0) {
      stopEarly = true
      return []
    }
    throw lastError
  }

  for (let batch = 1; batch <= totalBatches && !stopEarly; batch += 1) {
    const batchTarget = Math.min(batchSize, targetCount - prompts.length)
    const batchStart = prompts.length
    for (let attempt = 0; attempt < maxAttempts && !stopEarly; attempt += 1) {
      const stillNeeded = batchTarget - (prompts.length - batchStart)
      if (stillNeeded <= 0) break
      const batchCards = await runBatch(requestCountForBatch({ stillNeeded, providerId: request.providerId, attempt, batchSize }))
      addUniqueCards(prompts, batchCards, stillNeeded)
    }
    onBatchComplete?.({ phase: 'generating', batch, totalBatches, cardCount: prompts.length, targetCardCount: targetCount })
  }

  let topUpAttempts = 0
  while (!stopEarly && prompts.length < targetCount && topUpAttempts < (isDevice ? 16 : 6)) {
    topUpAttempts += 1
    const before = prompts.length
    const stillNeeded = Math.min(isDevice ? 4 : batchSize, targetCount - prompts.length)
    const batchCards = await runBatch(requestCountForBatch({ stillNeeded, providerId: request.providerId, attempt: topUpAttempts, batchSize }))
    addUniqueCards(prompts, batchCards, stillNeeded)
    if (prompts.length === before && topUpAttempts >= 3) break
  }

  return { prompts, complete: prompts.length >= targetCount }
}

export class AiProvider {
  async isDeviceReady() {
    const { status } = await getDeviceAiStatus({ useCache: true })
    return status === 'available'
  }

  async hasKey(providerId) {
    if (isDeviceProviderId(providerId)) return this.isDeviceReady()
    if (isNative()) return (await SecureAi.hasApiKey({ provider: providerId })).hasKey
    return Boolean(localStorage.getItem(webKeyStorage(providerId)))
  }

  async keyedProviderIds() {
    const flags = await Promise.all(AI_PROVIDERS.map((provider) => this.hasKey(provider.id)))
    return AI_PROVIDERS.filter((_, index) => flags[index]).map((provider) => provider.id)
  }

  async saveKey(providerId, apiKey) {
    if (isDeviceProviderId(providerId)) throw new Error('On-device AI does not use an API key.')
    if (isNative()) return SecureAi.saveApiKey({ provider: providerId, apiKey })
    localStorage.setItem(webKeyStorage(providerId), apiKey)
  }

  async removeKey(providerId) {
    if (isDeviceProviderId(providerId)) throw new Error('On-device AI does not use an API key.')
    if (isNative()) return SecureAi.removeApiKey({ provider: providerId })
    localStorage.removeItem(webKeyStorage(providerId))
  }

  async generateCards({ providerId = DEFAULT_PROVIDER_ID, name = '', category, audience, difficulty, count, excludedPrompts, spoilerSeries: requestedSpoilerSeries = '', harryPotterMode = false, specialPromptNote = '' }) {
    const meta = getProvider(providerId) || getProvider(DEFAULT_CLOUD_PROVIDER_ID)
    const subject = (name || category).trim()
    // Keep the on-device prompt small: a long exclusion list eats into Apple
    // Intelligence's limited context window. Client-side de-duplication catches
    // any repeats the trimmed list misses.
    const exclusionWindow = isDeviceProviderId(meta.id) ? 60 : 300
    const exclusions = excludedPrompts.slice(-exclusionWindow).join(', ')
    const spoilerSeries = getSpoilerSeries(requestedSpoilerSeries || (harryPotterMode ? 'harry_potter' : ''))
    const schema = spoilerSeries ? '{"cards":[{"prompt":"item","earliestInstallment":1}]}' : '{"cards":[{"prompt":"item"}]}'
    const spoilerRule = spoilerSeries ? `For every card, set earliestInstallment to the earliest ${spoilerSeries.label} installment where that person, place, object, creature, spell, or concept is revealed. Use a whole number from 1 through ${spoilerSeries.installments.length}. The order is: ${spoilerSeries.installments.map((installment, index) => `${index + 1}=${installment}`).join('; ')}. ` : ''
    const prompt = `Create exactly ${count} unique Heads Up style guessing prompts for a deck titled "${subject}" (category: ${category}). Audience: ${audience}. Difficulty: ${difficulty}. Extra deck guidance: ${specialPromptNote || 'None.'} Return only JSON of the form ${schema}. Every prompt must be a simple, clueable person, place, thing, creature, spell, or title of 1 to 4 words that clearly fits "${subject}". No sentences, descriptions, hints, questions, variants, subtitles, or duplicated answers. ${spoilerRule}Do not reuse or closely restate these existing prompts: ${exclusions}${isDeviceProviderId(meta.id) ? ' Put all cards in one cards array. Do not wrap each card in its own object.' : ''}`
    const { text } = await requestText(meta.id, meta.textModel, prompt)
    let cards
    try {
      cards = parseAiCardBatch(text)
    } catch {
      throw new Error('The AI returned an unreadable card batch. Please retry.')
    }
    return cards
      .map((card) => sanitizeGeneratedCard(card, spoilerSeries))
      .filter(Boolean)
  }

  async generateCover({ providerId = DEFAULT_PROVIDER_ID, name = '', category, audience, difficulty }) {
    const meta = getProvider(providerId) || getProvider(DEFAULT_CLOUD_PROVIDER_ID)
    const coverInput = () => ({ name: (name || category).trim(), category, audience, difficulty })
    const coverToBlob = (result) => {
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
      return new Blob([bytes], { type: result.mimeType || 'image/png' })
    }
    if (isDeviceProviderId(meta.id)) {
      // Image Playground is slow and frequently unavailable, and long, negative,
      // franchise-heavy prompts make it fail outright. Try one short, concept
      // style prompt (with an internal timeout) and fall back immediately to a
      // fast, always-available generated cover so on-device decks never stall.
      if (Capacitor.getPlatform() !== 'ios') return fallbackCover(category)
      try {
        const result = await requestImage(meta.id, meta.imageModel, deviceCoverConcept({ name: (name || category).trim(), category }))
        return coverToBlob(result)
      } catch {
        return fallbackCover(category)
      }
    }
    const result = await generateCoverWithFallback({
      getPromptInput: coverInput,
      requestImage: (prompt) => requestImage(meta.id, meta.imageModel, prompt)
    })
    return coverToBlob(result)
  }
}

export function fallbackCover(category) {
  const safe = category.replace(/[<>&]/g, '')
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff5d8f"/><stop offset=".5" stop-color="#713fd4"/><stop offset="1" stop-color="#0fcbcc"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="650" cy="170" r="180" fill="#ffe663" opacity=".88"/><circle cx="130" cy="810" r="210" fill="#10152d" opacity=".28"/><path d="M120 670 Q400 350 680 670" fill="none" stroke="white" stroke-width="22" opacity=".65"/><text x="400" y="500" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="800" font-size="56">${safe.slice(0, 24)}</text></svg>`], { type: 'image/svg+xml' })
}

export async function generateCustomPack(provider, request, onProgress, { skipAccuracyReview = false } = {}) {
  const targetCardCount = Number(request.cardCount ?? 100)
  if (!Number.isInteger(targetCardCount) || targetCardCount < 1 || targetCardCount > 350) throw new Error('Choose between 1 and 350 cards.')
  const batchSize = generationBatchSize(request.providerId)
  let cover = null
  const coverTask = provider.generateCover(request).then((result) => { cover = result }).catch(() => { cover = fallbackCover(request.category) })
  const { prompts, complete } = await fillCardTarget({
    provider,
    request,
    targetCount: targetCardCount,
    batchSize,
    onBatchComplete: onProgress
  })
  if (!prompts.length) {
    throw new Error('The AI did not generate any usable cards. Please try again.')
  }
  const partial = !complete
  const meta = getProvider(request.providerId) || getProvider(DEFAULT_CLOUD_PROVIDER_ID)
  // The accuracy review is a second full pass over every card. On slow
  // on-device models that roughly doubles generation time (the "extra deck"
  // feeling) while the small on-device model is a weak fact-checker anyway.
  // Cards are already sanitized and de-duplicated during generation, so we
  // reserve the review pass for cloud providers.
  const runAccuracyReview = !skipAccuracyReview && !isDeviceProviderId(meta.id)
  if (runAccuracyReview) {
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
        try { return parseAiJsonObject(text) } catch { throw new Error('The AI returned an unreadable accuracy review.') }
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
    cards: prompts.map((card) => ({ id: createId('card'), prompt: card.prompt, normalizedPrompt: normalizePrompt(card.prompt), earliestInstallment: card.earliestInstallment, firstShownAt: null })),
    requestedCardCount: targetCardCount,
    partial
  }
}

export { CLOUD_AI_PROVIDERS, DEFAULT_CLOUD_PROVIDER_ID, DEFAULT_PROVIDER_ID, DEVICE_PROVIDER_ID, isCloudProviderId, isDeviceProviderId }
