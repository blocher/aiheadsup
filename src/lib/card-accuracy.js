import { getSpoilerSeries } from './spoiler-series.js'
import { normalizePrompt } from './ids.js'

export const ACCURACY_BATCH_SIZE = 100

export function duplicateKey(prompt) {
  return prompt.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ')
    .map((word) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word))
    .join(' ')
}

export function chunkArray(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

export function accuracyReviewPrompt(deckMeta, cards, { chunkIndex = 0, chunkCount = 1 } = {}) {
  const subject = (deckMeta.name || deckMeta.category || '').trim()
  const series = getSpoilerSeries(deckMeta.spoilerSeries)
  const guidance = deckMeta.specialInstructions || deckMeta.specialPromptNote || 'None.'
  const chunkNote = chunkCount > 1 ? ` This is review batch ${chunkIndex + 1} of ${chunkCount}.` : ''
  const spoilerRule = series
    ? `For every kept card, include earliest_installment: the earliest ${series.label} installment where that item is revealed. Use a whole number from 1 through ${series.installments.length}. Order: ${series.installments.map((installment, index) => `${index + 1}=${installment}`).join('; ')}. `
    : ''
  const schema = series
    ? '{"cards":[{"prompt":"Golden Snitch","earliest_installment":1}]}'
    : '{"cards":[{"prompt":"Golden Snitch"}]}'
  const numbered = cards.map((card, index) => `${index + 1}. ${card.prompt}`).join('\n')
  return `You are a strict fact-checker for a Heads Up guessing game deck titled "${subject}" (category: ${deckMeta.category}).${chunkNote}

Review every card below for accuracy and quality. Return ONLY cards that clearly belong in this deck.

Remove cards that:
- Are factually wrong, hallucinated, invented, or not real for "${subject}"
- Are near-duplicates of another kept card (same entity with different wording, articles, or spelling)
- Belong to the wrong franchise, city, sport, park, book, movie, or topic
- Are full sentences, clues, descriptions, or questions instead of guessable answers
- Have more than 4 words
- Violate this deck guidance: ${guidance}

Fix minor spelling or naming errors only when the entity is clearly correct. Corrected prompts must stay 1-4 words.

Audience: ${deckMeta.audience}. Difficulty: ${deckMeta.difficulty}. ${spoilerRule}

Return only valid JSON in this exact shape: ${schema}
Include ONLY cards that pass review. Do not add new cards.

Cards to review:
${numbered}`
}

export function parseReviewedCards(payload, deckMeta) {
  const series = getSpoilerSeries(deckMeta.spoilerSeries)
  const seen = new Set()
  const cards = Array.isArray(payload?.cards) ? payload.cards : []
  return cards.flatMap((card) => {
    const prompt = String(typeof card === 'string' ? card : card?.prompt || '').trim()
    const earliestInstallment = Number(typeof card === 'object' ? card?.earliest_installment ?? card?.earliest_book ?? card?.earliestBook ?? card?.earliestInstallment : NaN)
    const key = duplicateKey(prompt)
    const validInstallment = !series || (Number.isInteger(earliestInstallment) && earliestInstallment >= 1 && earliestInstallment <= series.installments.length)
    if (!prompt || prompt.split(/\s+/).length > 4 || !validInstallment || seen.has(key)) return []
    seen.add(key)
    return [{ prompt, earliestInstallment: series ? earliestInstallment : null }]
  })
}

export function dedupeReviewedCards(cards) {
  const seen = new Set()
  return cards.filter((card) => {
    const key = duplicateKey(card.prompt)
    const normalized = normalizePrompt(card.prompt)
    if (seen.has(key) || seen.has(normalized)) return false
    seen.add(key)
    seen.add(normalized)
    return true
  })
}

export async function reviewDeckCards({ cards, deckMeta, requestReview, batchSize = ACCURACY_BATCH_SIZE, onProgress, logger = console }) {
  if (!cards.length) return []
  const chunks = chunkArray(cards, batchSize)
  const reviewed = []
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    let kept = []
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const payload = await requestReview(accuracyReviewPrompt(deckMeta, chunk, { chunkIndex: index, chunkCount: chunks.length }))
        kept = parseReviewedCards(payload, deckMeta)
        break
      } catch (error) {
        if (attempt === 3) {
          logger?.warn?.(`Accuracy review failed for batch ${index + 1}/${chunks.length}; keeping original cards. ${error.message}`)
          kept = chunk
        }
      }
    }
    reviewed.push(...kept)
    onProgress?.({
      phase: 'reviewing',
      chunk: index + 1,
      chunkCount: chunks.length,
      reviewedCount: reviewed.length,
      removedCount: cards.slice(0, (index + 1) * batchSize).length - reviewed.length,
      targetCardCount: cards.length
    })
  }
  return dedupeReviewedCards(reviewed)
}
