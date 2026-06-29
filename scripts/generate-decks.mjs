#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'smol-toml'
import { getSpoilerSeries } from '../src/lib/spoiler-series.js'
import { coverPromptForDeck, generateCoverWithFallback } from '../src/lib/cover-prompts.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaults = {
  input: path.join(root, 'src', 'decks.toml'),
  output: path.join(root, 'src', 'decks'),
  covers: path.join(root, 'public', 'covers'),
  model: 'gemini-3.5-flash',
  imageModel: 'gemini-3.1-flash-image',
  batchSize: 50,
  defaultCards: 350,
  images: false,
  dryRun: false,
  force: false,
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
  --images                Generate and save a Gemini cover for each deck (off by default)
  --dry-run               Print Gemini prompts only; do not request a key, call Gemini, or write files
  --model <id>            Gemini text model (default: gemini-3.5-flash)
  --image-model <id>      Gemini image model (default: gemini-3.1-flash-image, Nano Banana 2)
  --batch-size <number>   Cards requested per Gemini call (default: 50)
  --default-cards <n>     Used when number_of_cards is blank (default: 350)
  --force                 Regenerate existing TOML and requested cover files
  --help                  Show this help

The tool prompts for the Gemini API key only for real generation. It never writes the key to disk. A failed cover is retried up to four times; copyright rejections switch to a generic non-branded prompt before giving up.
Existing TOMLs are skipped. With --images, existing covers are skipped; if a TOML exists without a cover, only the cover is generated and linked.`
}

export function parseArguments(argv) {
  const options = { ...defaults }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') return { ...options, help: true }
    if (arg === '--images') { options.images = true; continue }
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--force') { options.force = true; continue }
    const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (!['input', 'output', 'covers', 'limit', 'model', 'imageModel', 'batchSize', 'defaultCards'].includes(key)) throw new Error(`Unknown option: ${arg}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    index += 1
    if (['limit', 'batchSize', 'defaultCards'].includes(key)) {
      const number = Number(value)
      if (!Number.isInteger(number) || number < 1) throw new Error(`${arg} must be a positive whole number.`)
      options[key] = number
    } else if (['input', 'output', 'covers'].includes(key)) {
      options[key] = path.resolve(process.cwd(), value)
    } else options[key] = value
  }
  return options
}

function slug(value) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck' }
function hash(value) { return createHash('sha256').update(value).digest('hex').slice(0, 8) }
function normalise(value) { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function audience(value) {
  const known = { kids: 'Kids', family: 'Family', teens: 'Teens+', 'teens+': 'Teens+', adults: 'Adults' }
  return known[String(value || 'family').trim().toLowerCase()] || String(value || 'Family').trim()
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
      id: `deck_${slug(name)}_${hash(`${name}|${category}`)}`,
      fileStem: `${slug(name)}-${hash(`${name}|${category}`)}`
    }
  })
}

export function cardPrompt(deck, count, excludedPrompts = []) {
  const series = getSpoilerSeries(deck.spoilerSeries)
  const spoilers = series
    ? `For every card include earliest_installment: the earliest ${series.label} installment in which it is revealed. Use a whole number from 1 through ${series.installments.length}. The release/story order is: ${series.installments.map((installment, index) => `${index + 1}=${installment}`).join('; ')}.`
    : 'Do not include spoiler metadata.'
  const schema = series
    ? '{"cards":[{"prompt":"Golden Snitch","earliest_installment":1}]}'
    : '{"cards":[{"prompt":"Golden Snitch"}]}'
  return `Create exactly ${count} unique, replayable Heads Up-style guessing cards.\n\nDeck name: ${deck.name}\nCategory: ${deck.category}\nDifficulty: ${deck.difficulty}\nTarget audience: ${deck.target}\nSpecial instructions: ${deck.specialInstructions || 'None.'}\n\nEvery card must be a guessable person, place, thing, creature, object, title, event, action, or game term appropriate to the specified difficulty and audience. Each prompt must be one word or a very short phrase of at most 4 words. Never return clues, definitions, full sentences, questions, descriptions, duplicate answers, or near-duplicates. ${spoilers}\n\nReturn only valid JSON in this exact shape: ${schema}\n\nDo not reuse or closely restate any of these already selected cards: ${excludedPrompts.slice(-350).join(', ') || 'None yet.'}`
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

function extractText(payload) {
  const text = (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text).filter(Boolean).join('\n').trim()
  if (!text) throw new Error('Gemini did not return a text response.')
  const json = text.replace(/^```json\s*|\s*```$/g, '')
  try { return JSON.parse(json) } catch { throw new Error('Gemini returned invalid JSON.') }
}

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

export async function generateCards(apiKey, deck, options) {
  const saved = []
  while (saved.length < deck.numberOfCards) {
    const wanted = Math.min(options.batchSize, deck.numberOfCards - saved.length)
    const batchStart = saved.length
    let completed = false
    for (let attempt = 1; attempt <= 4 && !completed; attempt += 1) {
      const stillNeeded = wanted - (saved.length - batchStart)
      const payload = await geminiRequest(apiKey, options.model, cardPrompt(deck, stillNeeded, saved))
      let parsed
      try {
        parsed = extractText(payload)
      } catch (error) {
        if (error.message !== 'Gemini returned invalid JSON.') throw error
        if (attempt < 4) {
          console.warn(`Warning: Gemini returned invalid JSON for “${deck.name}”. Retrying (${attempt}/3)…`)
          continue
        }
        console.warn(`Warning: Gemini returned invalid JSON three times for “${deck.name}”. Saving available cards and continuing.`)
        break
      }
      const newCards = validateCards(parsed, deck, saved)
      saved.push(...newCards.slice(0, stillNeeded))
      if (saved.length - batchStart === wanted) completed = true
    }
    if (!completed) {
      console.warn(`Warning: Gemini produced ${saved.length} of ${deck.numberOfCards} valid cards for “${deck.name}”. Saving the partial deck and continuing.`)
      break
    }
  }
  return saved
}

export async function generateCover(apiKey, deck, options) {
  try {
    const payload = await generateCoverWithFallback({
      getPromptInput: () => ({
        name: deck.name,
        category: deck.category,
        audience: deck.target,
        difficulty: deck.difficulty,
        specialInstructions: deck.specialInstructions
      }),
      requestImage: async (prompt) => {
        const response = await geminiRequest(apiKey, options.imageModel, prompt, true)
        const inlineData = (response.candidates?.[0]?.content?.parts || []).find((part) => part.inlineData)?.inlineData
        if (!inlineData?.data) throw new Error('Gemini did not return a cover image.')
        return response
      },
      onRetry: ({ attempt, generic, error }) => {
        const reason = generic ? 'Retrying with a generic non-copyrighted cover prompt' : 'Retrying cover generation'
        console.warn(`Warning: Could not generate a cover for “${deck.name}”. ${reason} (${attempt}/3)… ${error.message}`)
      }
    })
    const inlineData = (payload.candidates?.[0]?.content?.parts || []).find((part) => part.inlineData)?.inlineData
    return { bytes: Buffer.from(inlineData.data, 'base64'), extension: inlineData.mimeType === 'image/jpeg' ? 'jpg' : inlineData.mimeType === 'image/webp' ? 'webp' : 'png' }
  } catch (error) {
    console.warn(`Warning: Could not generate a cover for “${deck.name}” after retries. Continuing without a cover. ${error.message}`)
    return null
  }
}

function outputToml(deck, cards, photoFileName = null) {
  return stringify({
    id: deck.id,
    revision: 1,
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
  if (options.force) return { deck, tomlPath, existingDeck, coverFileName, generateCards: true, generateImage: options.images, updateToml: false }
  if (tomlExists) {
    const updateToml = Boolean(options.images && coverFileName && existingDeck.photo_file_name !== coverFileName)
    return { deck, tomlPath, existingDeck, coverFileName, generateCards: false, generateImage: options.images && !coverFileName, updateToml }
  }
  return { deck, tomlPath, existingDeck: null, coverFileName, generateCards: true, generateImage: options.images && !coverFileName, updateToml: false }
}

async function promptForApiKey() {
  if (!process.stdin.isTTY) throw new Error('A Gemini API key must be entered in an interactive terminal.')
  return new Promise((resolve) => {
    const stdin = process.stdin
    let value = ''
    process.stdout.write('Gemini API key (not saved): ')
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
  if (plan.generateCards) {
    process.stdout.write(`Generating ${deck.name} (${deck.numberOfCards} cards)…\n`)
    cards = await generateCards(apiKey, deck, options)
    if (!cards.length) {
      console.warn(`Warning: Gemini produced no valid cards for “${deck.name}”. Skipping this deck and continuing.`)
      return
    }
  }
  let photoFileName = plan.coverFileName
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
    await writeFile(tomlPath, outputToml(deck, cards, photoFileName))
  } else if (cover || plan.updateToml) {
    await writeFile(tomlPath, stringify({ ...existingDeck, photo_file_name: photoFileName }))
  }
  const cardCount = cards ? ` (${cards.length}/${deck.numberOfCards} cards)` : ''
  process.stdout.write(`Wrote ${path.relative(root, tomlPath)}${cardCount}\n`)
}

export async function run(options) {
  const definitions = readDefinitions(await readFile(options.input, 'utf8'), options.defaultCards).slice(0, options.limit ?? undefined)
  const plans = await Promise.all(definitions.map((deck) => planDeckWork(deck, options)))
  if (options.dryRun) {
    for (const plan of plans) {
      if (plan.generateCards) process.stdout.write(`\n# ${plan.deck.name} — card prompt\n${cardPrompt(plan.deck, Math.min(options.batchSize, plan.deck.numberOfCards))}\n`)
      if (plan.generateImage) process.stdout.write(`\n# ${plan.deck.name} — cover prompt\n${coverPrompt(plan.deck)}\n`)
      if (plan.updateToml) process.stdout.write(`\n# ${plan.deck.name} — existing cover will be linked locally; no Gemini request needed.\n`)
      if (!plan.generateCards && !plan.generateImage && !plan.updateToml) process.stdout.write(`\n# ${plan.deck.name} — already complete; no Gemini request needed.\n`)
    }
    return
  }
  const writes = plans.filter((plan) => plan.generateCards || plan.generateImage || plan.updateToml)
  const geminiWork = writes.filter((plan) => plan.generateCards || plan.generateImage)
  if (!writes.length) {
    console.log('Every requested deck is already complete; no Gemini request needed.')
    return
  }
  if (!geminiWork.length) {
    for (const plan of writes) await writeDeck(null, plan, options)
    console.log('Linked existing covers; no Gemini request needed.')
    return
  }
  const apiKey = await promptForApiKey()
  if (!apiKey) throw new Error('No Gemini API key entered.')
  for (const plan of writes) await writeDeck(apiKey, plan, options)
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
