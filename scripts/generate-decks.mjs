#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'smol-toml'
import { getSpoilerSeries } from '../src/lib/spoiler-series.js'
import { coverPromptForDeck, generateCoverWithFallback } from '../src/lib/cover-prompts.js'
import { getProvider, isProviderId } from '../src/lib/ai-providers.js'
import { reviewDeckCards } from '../src/lib/card-accuracy.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROVIDER_ENV = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }
const defaults = {
  input: path.join(root, 'src', 'decks.toml'),
  output: path.join(root, 'src', 'decks'),
  covers: path.join(root, 'public', 'covers'),
  provider: 'gemini',
  model: null,
  imageModel: null,
  batchSize: 50,
  defaultCards: 350,
  concurrency: 1,
  images: false,
  dryRun: false,
  force: false,
  topUp: false,
  rereview: false,
  limit: null
}

export function usage() {
  return `Generate bundled Forehead Frenzy deck TOMLs from a deck definition file.

Usage:
  npx --no-install npm run generate:decks -- [options]

Options:
  --input <file>          Definition file (default: src/decks.toml)
  --output <directory>    Generated TOML directory (default: src/decks)
  --covers <directory>    Generated cover directory (default: public/covers)
  --limit <number>        Only process the first N definition lines/decks
  --provider <id>         AI provider: gemini or openai (default: gemini)
  --images                Generate and save a cover for each deck (off by default)
  --dry-run               Print prompts only; do not request a key, call the API, or write files
  --model <id>            Text model (default: provider's default)
  --image-model <id>      Image model (default: provider's default)
  --batch-size <number>   Cards requested per API call (default: 50)
  --default-cards <n>     Used when number_of_cards is blank (default: 350)
  --concurrency <n>       Generate up to N decks in parallel (default: 1)
  --top-up                For existing decks under target, add carefully reviewed cards
  --rereview              Re-run accuracy/relevance review on existing deck cards and fix issues
  --force                 Regenerate existing TOML and requested cover files
  --help                  Show this help

Set the API key via GEMINI_API_KEY or OPENAI_API_KEY (matching --provider), or enter it when prompted. The key is never written to disk. A failed cover is retried up to four times; copyright rejections switch to a generic non-branded prompt before giving up.
Existing TOMLs are skipped unless --force, --top-up, and/or --rereview is set. --top-up prefers fewer good cards over filling with weak ones. --rereview can be combined with --top-up (review first, then top up). Cannot combine --force with --top-up or --rereview. With --images, existing covers are skipped; if a TOML exists without a cover, only the cover is generated and linked. Parallelism is mostly API-bound; raise --concurrency carefully to avoid provider rate limits.`
}

export function parseArguments(argv) {
  const options = { ...defaults }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') return { ...options, help: true }
    if (arg === '--images') { options.images = true; continue }
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--force') { options.force = true; continue }
    if (arg === '--top-up') { options.topUp = true; continue }
    if (arg === '--rereview') { options.rereview = true; continue }
    const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (!['input', 'output', 'covers', 'limit', 'provider', 'model', 'imageModel', 'batchSize', 'defaultCards', 'concurrency'].includes(key)) throw new Error(`Unknown option: ${arg}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    index += 1
    if (['limit', 'batchSize', 'defaultCards', 'concurrency'].includes(key)) {
      const number = Number(value)
      if (!Number.isInteger(number) || number < 1) throw new Error(`${arg} must be a positive whole number.`)
      options[key] = number
    } else if (['input', 'output', 'covers'].includes(key)) {
      options[key] = path.resolve(process.cwd(), value)
    } else options[key] = value
  }
  if (options.force && (options.topUp || options.rereview)) {
    throw new Error('Cannot combine --force with --top-up or --rereview.')
  }
  if (!isProviderId(options.provider)) throw new Error(`--provider must be one of: gemini, openai.`)
  const meta = getProvider(options.provider)
  options.model = options.model || meta.textModel
  options.imageModel = options.imageModel || meta.imageModel
  return options
}

function slug(value) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck' }
function hash(value) { return createHash('sha256').update(value).digest('hex').slice(0, 8) }
function normalise(value) { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function audience(value) {
  const known = { kids: 'Kids', family: 'Family', teens: 'Teens+', 'teens+': 'Teens+', adults: 'Adults' }
  return known[String(value || 'family').trim().toLowerCase()] || String(value || 'Family').trim()
}

export async function mapPool(items, concurrency, mapper) {
  const limit = Math.max(1, concurrency)
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()))
  return results
}

export function readDefinitions(source, defaultCards = defaults.defaultCards) {
  const raw = parse(source)
  if (!Array.isArray(raw.decks) || raw.decks.length === 0) throw new Error('The input TOML must contain a non-empty decks array.')
  return raw.decks.map((entry, index) => {
    const name = String(entry.name || '').trim()
    const category = String(entry.category || '').trim()
    const difficulty = String(entry.difficulty || '').trim().toLowerCase()
    const requested = String(entry.number_of_cards ?? '').trim()
    const numberOfCards = requested ? Number(requested) : defaultCards
    if (!name || !category || !['easy', 'medium', 'hard'].includes(difficulty)) throw new Error(`Deck ${index + 1} needs name, category, and easy/medium/hard difficulty.`)
    if (!Number.isInteger(numberOfCards) || numberOfCards < 1) throw new Error(`Deck “${name}” has an invalid number_of_cards.`)
    const spoilerSeries = String(entry.spoiler_series || '').trim() || (entry.include_harry_potter_book_number ? 'harry_potter' : '')
    if (spoilerSeries && !getSpoilerSeries(spoilerSeries)) throw new Error(`Deck “${name}” has an unknown spoiler_series.`)
    return {
      name,
      category,
      difficulty,
      target: audience(entry.target),
      numberOfCards,
      specialInstructions: String(entry.special_instructions ?? '').trim(),
      spoilerSeries,
      excludeFrom: String(entry.exclude_from ?? '').trim(),
      id: `deck_${slug(name)}_${hash(`${name}|${category}`)}`,
      fileStem: `${slug(name)}-${hash(`${name}|${category}`)}`
    }
  })
}

async function loadExcludedPrompts(deck, options) {
  if (!deck.excludeFrom) return []
  const files = await readdir(options.output)
  const prompts = []
  for (const file of files) {
    if (!file.endsWith('.toml')) continue
    const parsed = parse(await readFile(path.join(options.output, file), 'utf8'))
    if (String(parsed.name || '').trim() !== deck.excludeFrom) continue
    for (const card of parsed.cards || []) {
      const text = String(typeof card === 'string' ? card : card?.text || '').trim()
      if (text) prompts.push(text)
    }
  }
  if (!prompts.length) console.warn(`Warning: exclude_from “${deck.excludeFrom}” for “${deck.name}” matched no cards.`)
  return prompts
}

export function cardPrompt(deck, count, excludedPrompts = []) {
  const series = getSpoilerSeries(deck.spoilerSeries)
  const spoilers = series
    ? `For every card include earliest_installment: the earliest ${series.label} installment in which it is revealed. Use a whole number from 1 through ${series.installments.length}. The release/story order is: ${series.installments.map((installment, index) => `${index + 1}=${installment}`).join('; ')}.`
    : 'Do not include spoiler metadata.'
  const schema = series
    ? '{"cards":[{"prompt":"Golden Snitch","earliest_installment":1}]}'
    : '{"cards":[{"prompt":"Golden Snitch"}]}'
  const quality = deck.strictQuality
    ? 'Quality over quantity: only include cards you are highly confident are accurate and clearly relevant to this deck. Prefer returning fewer cards over inventing obscure, weak, borderline, or questionable entries. Do not pad the list.'
    : ''
  return `Create exactly ${count} unique, replayable Heads Up-style guessing cards.\n\nDeck name: ${deck.name}\nCategory: ${deck.category}\nDifficulty: ${deck.difficulty}\nTarget audience: ${deck.target}\nSpecial instructions: ${deck.specialInstructions || 'None.'}\n${quality}\n\nEvery card must be a guessable person, place, thing, creature, object, title, event, action, or game term appropriate to the specified difficulty and audience. Each prompt must be one word or a very short phrase of at most 4 words. Never return clues, definitions, full sentences, questions, descriptions, duplicate answers, or near-duplicates. ${spoilers}\n\nReturn only valid JSON in this exact shape: ${schema}\n\nDo not reuse or closely restate any of these already selected cards: ${excludedPrompts.slice(-350).join(', ') || 'None yet.'}`
}

export function coverPrompt(deck) {
  return coverPromptForDeck({
    name: deck.name,
    category: deck.category,
    audience: deck.target,
    difficulty: deck.difficulty,
    specialInstructions: deck.specialInstructions
  })
}

export function validateCards(payload, deck, knownCards = []) {
  const series = getSpoilerSeries(deck.spoilerSeries)
  const seen = new Set(knownCards.map((card) => normalise(card.prompt)))
  const cards = Array.isArray(payload?.cards) ? payload.cards : []
  return cards.flatMap((card) => {
    const prompt = String(typeof card === 'string' ? card : card?.prompt || '').trim()
    const earliestInstallment = Number(typeof card === 'object' ? card?.earliest_installment ?? card?.earliest_book ?? card?.earliestBook : NaN)
    const key = normalise(prompt)
    const validInstallment = !series || (Number.isInteger(earliestInstallment) && earliestInstallment >= 1 && earliestInstallment <= series.installments.length)
    if (!key || prompt.split(/\s+/).length > 4 || !validInstallment || seen.has(key)) return []
    seen.add(key)
    return [{ prompt, earliestInstallment: series ? earliestInstallment : null }]
  })
}

export function cardsFromExistingDeck(existingDeck, spoilerSeries = '') {
  const series = getSpoilerSeries(spoilerSeries)
  return (existingDeck?.cards || []).flatMap((card) => {
    const prompt = String(typeof card === 'string' ? card : card?.text || '').trim()
    if (!prompt) return []
    const earliestInstallment = Number(typeof card === 'object' ? card?.first_revealed_installment ?? card?.first_revealed_book : NaN)
    return [{
      prompt,
      earliestInstallment: series && Number.isInteger(earliestInstallment) ? earliestInstallment : null
    }]
  })
}

export function cardsSignature(cards = []) {
  return cards.map((card) => `${card.prompt}\t${card.earliestInstallment ?? ''}`).join('\n')
}

function deckMetaFrom(deck) {
  return {
    name: deck.name,
    category: deck.category,
    audience: deck.target,
    difficulty: deck.difficulty[0].toUpperCase() + deck.difficulty.slice(1),
    specialInstructions: deck.specialInstructions,
    spoilerSeries: deck.spoilerSeries
  }
}

async function reviewCards(apiKey, deck, cards, options) {
  if (!cards.length) return []
  process.stdout.write(`Reviewing ${cards.length} card(s) for “${deck.name}”…\n`)
  return reviewDeckCards({
    cards,
    deckMeta: deckMetaFrom(deck),
    requestReview: (prompt) => requestCardBatch(apiKey, options, prompt),
    onProgress: ({ chunk, chunkCount, removedCount }) => {
      if (removedCount > 0) process.stdout.write(`  Accuracy batch ${chunk}/${chunkCount}: removed ${removedCount} so far…\n`)
    },
    logger: console
  })
}

const INVALID_JSON_ERROR = 'The AI returned invalid JSON.'

function parseCardJson(text) {
  if (!text?.trim()) throw new Error('The AI did not return a text response.')
  const json = text.replace(/^```json\s*|\s*```$/g, '')
  try { return JSON.parse(json) } catch { throw new Error(INVALID_JSON_ERROR) }
}

function providerLabel(provider) { return getProvider(provider)?.short || 'Gemini' }

async function geminiRequest(apiKey, model, prompt, image = false) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], ...(image ? {} : { generationConfig: { responseMimeType: 'application/json' } }) })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || `Gemini request failed (${response.status}).`)
  return payload
}

async function openaiRequest(apiKey, model, prompt, image = false) {
  const url = image ? 'https://api.openai.com/v1/images/generations' : 'https://api.openai.com/v1/chat/completions'
  const body = image
    ? { model, prompt, size: '1024x1536' }
    : { model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status}).`)
  return payload
}

async function requestCardBatch(apiKey, options, prompt) {
  if ((options.provider || 'gemini') === 'openai') {
    const payload = await openaiRequest(apiKey, options.model, prompt, false)
    return parseCardJson(payload.choices?.[0]?.message?.content)
  }
  const payload = await geminiRequest(apiKey, options.model, prompt, false)
  return parseCardJson((payload.candidates?.[0]?.content?.parts || []).map((part) => part.text).filter(Boolean).join('\n'))
}

async function requestCoverImage(apiKey, options, prompt) {
  if ((options.provider || 'gemini') === 'openai') {
    const payload = await openaiRequest(apiKey, options.imageModel, prompt, true)
    const base64 = payload.data?.[0]?.b64_json
    if (!base64) throw new Error('OpenAI did not return a cover image.')
    return { bytes: Buffer.from(base64, 'base64'), extension: 'png' }
  }
  const payload = await geminiRequest(apiKey, options.imageModel, prompt, true)
  const inlineData = (payload.candidates?.[0]?.content?.parts || []).find((part) => part.inlineData)?.inlineData
  if (!inlineData?.data) throw new Error('Gemini did not return a cover image.')
  return { bytes: Buffer.from(inlineData.data, 'base64'), extension: inlineData.mimeType === 'image/jpeg' ? 'jpg' : inlineData.mimeType === 'image/webp' ? 'webp' : 'png' }
}

export async function generateCards(apiKey, deck, options) {
  const excludedPrompts = deck.excludedPrompts || []
  const excludedCards = excludedPrompts.map((prompt) => ({ prompt }))
  const saved = []
  const maxRounds = deck.strictQuality ? 2 : Infinity
  let rounds = 0
  while (saved.length < deck.numberOfCards && rounds < maxRounds) {
    rounds += 1
    const wanted = Math.min(options.batchSize, deck.numberOfCards - saved.length)
    const batchStart = saved.length
    let completed = false
    const label = providerLabel(options.provider)
    for (let attempt = 1; attempt <= 4 && !completed; attempt += 1) {
      const stillNeeded = wanted - (saved.length - batchStart)
      let parsed
      try {
        parsed = await requestCardBatch(apiKey, options, cardPrompt(deck, stillNeeded, [...excludedPrompts, ...saved.map((card) => card.prompt)]))
      } catch (error) {
        if (error.message !== INVALID_JSON_ERROR) throw error
        if (attempt < 4) {
          console.warn(`Warning: ${label} returned invalid JSON for “${deck.name}”. Retrying (${attempt}/3)…`)
          continue
        }
        console.warn(`Warning: ${label} returned invalid JSON three times for “${deck.name}”. Saving available cards and continuing.`)
        break
      }
      const newCards = validateCards(parsed, deck, [...excludedCards, ...saved])
      saved.push(...newCards.slice(0, stillNeeded))
      if (saved.length - batchStart === wanted) completed = true
    }
    if (!completed) {
      console.warn(`Warning: ${providerLabel(options.provider)} produced ${saved.length} of ${deck.numberOfCards} valid cards for “${deck.name}”. Saving the partial deck and continuing.`)
      break
    }
  }
  if (!saved.length) return saved
  const reviewed = await reviewCards(apiKey, deck, saved, options)
  const exclusionKeys = new Set(excludedPrompts.map((prompt) => normalise(prompt)))
  const deduped = reviewed.filter((card) => !exclusionKeys.has(normalise(card.prompt)))
  if (deduped.length < reviewed.length) {
    console.warn(`Warning: Removed ${reviewed.length - deduped.length} card(s) from “${deck.name}” that overlapped exclude_from.`)
  } else if (reviewed.length < saved.length) {
    console.warn(`Warning: Accuracy review removed ${saved.length - reviewed.length} card(s) from “${deck.name}”.`)
  }
  return deduped
}

export async function generateCover(apiKey, deck, options) {
  try {
    return await generateCoverWithFallback({
      getPromptInput: () => ({
        name: deck.name,
        category: deck.category,
        audience: deck.target,
        difficulty: deck.difficulty,
        specialInstructions: deck.specialInstructions
      }),
      requestImage: (prompt) => requestCoverImage(apiKey, options, prompt),
      onRetry: ({ attempt, generic, error }) => {
        const reason = generic ? 'Retrying with a generic non-copyrighted cover prompt' : 'Retrying cover generation'
        console.warn(`Warning: Could not generate a cover for “${deck.name}”. ${reason} (${attempt}/3)… ${error.message}`)
      }
    })
  } catch (error) {
    console.warn(`Warning: Could not generate a cover for “${deck.name}” after retries. Continuing without a cover. ${error.message}`)
    return null
  }
}

function outputToml(deck, cards, photoFileName = null, revision = 1) {
  return stringify({
    id: deck.id,
    revision,
    name: deck.name,
    category: deck.category,
    audience: deck.target,
    difficulty: deck.difficulty[0].toUpperCase() + deck.difficulty.slice(1),
    special_prompt_note: deck.specialInstructions,
    ...(photoFileName ? { photo_file_name: photoFileName } : {}),
    spoiler_mode: Boolean(deck.spoilerSeries),
    ...(deck.spoilerSeries ? { spoiler_series: deck.spoilerSeries } : {}),
    cards: cards.map((card) => ({ text: card.prompt, ...(deck.spoilerSeries ? { first_revealed_installment: card.earliestInstallment } : {}) }))
  })
}

async function exists(file) { try { await access(file); return true } catch { return false } }

async function existingCover(deck, options, existingDeck = null) {
  const declared = existingDeck?.photo_file_name ? path.basename(existingDeck.photo_file_name) : null
  const candidates = [
    declared,
    ...['png', 'jpg', 'jpeg', 'webp'].map((extension) => `${deck.fileStem}-cover.${extension}`)
  ].filter(Boolean)
  for (const fileName of [...new Set(candidates)]) {
    if (await exists(path.join(options.covers, fileName))) return fileName
  }
  return null
}

export async function planDeckWork(deck, options) {
  const tomlPath = path.join(options.output, `${deck.fileStem}.toml`)
  const tomlExists = await exists(tomlPath)
  const existingDeck = tomlExists ? parse(await readFile(tomlPath, 'utf8')) : null
  const coverFileName = await existingCover(deck, options, existingDeck)
  const existingCount = cardsFromExistingDeck(existingDeck, deck.spoilerSeries).length
  const shortfall = Math.max(0, deck.numberOfCards - existingCount)
  if (options.force) {
    return { deck, tomlPath, existingDeck, coverFileName, generateCards: true, generateImage: options.images, updateToml: false, rereview: false, topUp: false, shortfall: 0 }
  }
  if (!tomlExists) {
    return { deck, tomlPath, existingDeck: null, coverFileName, generateCards: true, generateImage: options.images && !coverFileName, updateToml: false, rereview: false, topUp: false, shortfall: 0 }
  }
  const updateToml = Boolean(options.images && coverFileName && existingDeck.photo_file_name !== coverFileName)
  return {
    deck,
    tomlPath,
    existingDeck,
    coverFileName,
    generateCards: false,
    generateImage: options.images && !coverFileName,
    updateToml,
    rereview: Boolean(options.rereview),
    topUp: Boolean(options.topUp && shortfall > 0),
    shortfall
  }
}

async function resolveApiKey(provider) {
  const envName = PROVIDER_ENV[provider]
  const fromEnv = process.env[envName]?.trim()
  if (fromEnv) {
    process.stdout.write(`Using ${getProvider(provider).label} key from ${envName}.\n`)
    return fromEnv
  }
  return promptForApiKey(provider)
}

async function promptForApiKey(provider = 'gemini') {
  const meta = getProvider(provider)
  if (!process.stdin.isTTY) throw new Error(`Set ${PROVIDER_ENV[provider]} or enter the ${meta.label} API key in an interactive terminal.`)
  return new Promise((resolve) => {
    const stdin = process.stdin
    let value = ''
    process.stdout.write(`${meta.label} API key (not saved): `)
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (character) => {
      if (character === '\r' || character === '\n') { cleanup(); process.stdout.write('\n'); resolve(value.trim()); return }
      if (character === '\u0003') { cleanup(); process.stdout.write('\n'); process.exitCode = 130; resolve(''); return }
      if (character === '\u007f') { value = value.slice(0, -1); return }
      value += character
    }
    function cleanup() { stdin.off('data', onData); stdin.setRawMode?.(false); stdin.pause() }
    stdin.on('data', onData)
  })
}

async function writeDeck(apiKey, plan, options) {
  const { deck, tomlPath, existingDeck } = plan
  let cards = null
  let revision = Number(existingDeck?.revision) > 0 ? Number(existingDeck.revision) : 1
  const beforeSignature = existingDeck ? cardsSignature(cardsFromExistingDeck(existingDeck, deck.spoilerSeries)) : ''

  if (plan.generateCards) {
    process.stdout.write(`Generating ${deck.name} (${deck.numberOfCards} cards)…\n`)
    cards = await generateCards(apiKey, deck, options)
    if (!cards.length) {
      console.warn(`Warning: ${providerLabel(options.provider)} produced no valid cards for “${deck.name}”. Skipping this deck and continuing.`)
      return
    }
    revision = existingDeck ? revision + 1 : 1
  } else if (plan.rereview || plan.topUp) {
    let working = cardsFromExistingDeck(existingDeck, deck.spoilerSeries)
    if (plan.rereview) {
      const beforeCount = working.length
      working = await reviewCards(apiKey, deck, working, options)
      const exclusionKeys = new Set((deck.excludedPrompts || []).map((prompt) => normalise(prompt)))
      const withoutExcluded = working.filter((card) => !exclusionKeys.has(normalise(card.prompt)))
      if (withoutExcluded.length < working.length) {
        console.warn(`Warning: Removed ${working.length - withoutExcluded.length} card(s) from “${deck.name}” that overlapped exclude_from.`)
      }
      working = withoutExcluded
      if (working.length < beforeCount) {
        console.warn(`Warning: Re-review removed ${beforeCount - working.length} card(s) from “${deck.name}”.`)
      }
    }
    if (options.topUp) {
      const needed = Math.max(0, deck.numberOfCards - working.length)
      if (needed > 0) {
        process.stdout.write(`Topping up ${deck.name} (need up to ${needed} more toward ${deck.numberOfCards})…\n`)
        const additions = await generateCards(apiKey, {
          ...deck,
          numberOfCards: needed,
          strictQuality: true,
          excludedPrompts: [...(deck.excludedPrompts || []), ...working.map((card) => card.prompt)]
        }, options)
        if (additions.length) {
          working = [...working, ...additions]
          process.stdout.write(`  Added ${additions.length} reviewed card(s) to “${deck.name}” (${working.length}/${deck.numberOfCards}).\n`)
        } else {
          console.warn(`Warning: Top-up produced no additional high-confidence cards for “${deck.name}”. Keeping ${working.length}/${deck.numberOfCards}.`)
        }
      } else {
        process.stdout.write(`“${deck.name}” already at or above target (${working.length}/${deck.numberOfCards}); no top-up needed.\n`)
      }
    }
    if (cardsSignature(working) !== beforeSignature) {
      cards = working
      revision += 1
    } else {
      process.stdout.write(`No card changes for “${deck.name}” after review/top-up.\n`)
    }
  }

  let photoFileName = plan.coverFileName || existingDeck?.photo_file_name || null
  if (photoFileName) photoFileName = path.basename(photoFileName)
  let cover = null
  if (plan.generateImage) {
    process.stdout.write(`Generating cover for ${deck.name}…\n`)
    cover = await generateCover(apiKey, deck, options)
    if (cover) photoFileName = `${deck.fileStem}-cover.${cover.extension}`
  }
  if (cover) {
    await mkdir(options.covers, { recursive: true })
    await writeFile(path.join(options.covers, photoFileName), cover.bytes)
  }
  if (cards) {
    await mkdir(options.output, { recursive: true })
    await writeFile(tomlPath, outputToml(deck, cards, photoFileName, revision))
  } else if (cover || plan.updateToml) {
    await writeFile(tomlPath, stringify({ ...existingDeck, photo_file_name: photoFileName }))
  }
  const cardCount = cards ? ` (${cards.length}/${deck.numberOfCards} cards, rev ${revision})` : ''
  if (cards || cover || plan.updateToml) process.stdout.write(`Wrote ${path.relative(root, tomlPath)}${cardCount}\n`)
}

export async function run(options) {
  const definitions = readDefinitions(await readFile(options.input, 'utf8'), options.defaultCards).slice(0, options.limit ?? undefined)
  for (const deck of definitions) {
    deck.excludedPrompts = await loadExcludedPrompts(deck, options)
    if (deck.excludedPrompts.length) process.stdout.write(`Loaded ${deck.excludedPrompts.length} exclusion(s) for “${deck.name}” from “${deck.excludeFrom}”.\n`)
  }
  const plans = await Promise.all(definitions.map((deck) => planDeckWork(deck, options)))
  const label = getProvider(options.provider).label
  if (options.dryRun) {
    for (const plan of plans) {
      if (plan.generateCards) process.stdout.write(`\n# ${plan.deck.name} — card prompt\n${cardPrompt(plan.deck, Math.min(options.batchSize, plan.deck.numberOfCards), plan.deck.excludedPrompts)}\n`)
      if (plan.rereview) process.stdout.write(`\n# ${plan.deck.name} — would re-review ${cardsFromExistingDeck(plan.existingDeck, plan.deck.spoilerSeries).length} existing card(s).\n`)
      if (plan.topUp) process.stdout.write(`\n# ${plan.deck.name} — would top up by up to ${plan.shortfall} card(s) with strict quality review.\n`)
      if (plan.generateImage) process.stdout.write(`\n# ${plan.deck.name} — cover prompt\n${coverPrompt(plan.deck)}\n`)
      if (plan.updateToml) process.stdout.write(`\n# ${plan.deck.name} — existing cover will be linked locally; no ${label} request needed.\n`)
      if (!plan.generateCards && !plan.generateImage && !plan.updateToml && !plan.rereview && !plan.topUp) {
        process.stdout.write(`\n# ${plan.deck.name} — already complete; no ${label} request needed.\n`)
      }
    }
    return
  }
  const writes = plans.filter((plan) => plan.generateCards || plan.generateImage || plan.updateToml || plan.rereview || plan.topUp)
  const apiWork = writes.filter((plan) => plan.generateCards || plan.generateImage || plan.rereview || plan.topUp)
  if (!writes.length) {
    console.log(`Every requested deck is already complete; no ${label} request needed.`)
    return
  }
  if (!apiWork.length) {
    for (const plan of writes) await writeDeck(null, plan, options)
    console.log(`Linked existing covers; no ${label} request needed.`)
    return
  }
  const modes = [
    options.images ? `images: ${options.imageModel}` : null,
    options.rereview ? 'rereview' : null,
    options.topUp ? 'top-up' : null,
    `concurrency: ${options.concurrency}`
  ].filter(Boolean).join(', ')
  process.stdout.write(`Using ${label} (text: ${options.model}${modes ? `, ${modes}` : ''}).\n`)
  const apiKey = await resolveApiKey(options.provider)
  if (!apiKey) throw new Error(`No ${label} API key provided.`)
  await mapPool(writes, options.concurrency, async (plan) => {
    try {
      await writeDeck(apiKey, plan, options)
    } catch (error) {
      console.error(`Error generating “${plan.deck.name}”: ${error.message}`)
      process.exitCode = 1
    }
  })
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) { console.log(usage()); return }
    await run(options)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
