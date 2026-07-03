export function extractJsonText(text) {
  if (!text?.trim()) return ''
  let cleaned = text.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) cleaned = fenceMatch[1].trim()
  return cleaned
}

function parseJsonValue(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    const objectStart = raw.indexOf('{')
    const arrayStart = raw.indexOf('[')
    let start = -1
    if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) start = objectStart
    else if (arrayStart >= 0) start = arrayStart
    if (start < 0) throw new Error('No JSON found')
    const slice = raw.slice(start)
    try {
      return JSON.parse(slice)
    } catch {
      return JSON.parse(repairTruncatedJson(slice))
    }
  }
}

function repairTruncatedJson(raw) {
  let text = raw.trim()
  text = text.replace(/,\s*$/, '')
  const openBraces = (text.match(/{/g) || []).length
  const closeBraces = (text.match(/}/g) || []).length
  const openBrackets = (text.match(/\[/g) || []).length
  const closeBrackets = (text.match(/]/g) || []).length
  text += ']'.repeat(Math.max(0, openBrackets - closeBrackets))
  text += '}'.repeat(Math.max(0, openBraces - closeBraces))
  return text
}

export function normalizeCardBatch(parsed) {
  if (!parsed) return []
  if (Array.isArray(parsed)) {
    if (parsed.every((item) => Array.isArray(item?.cards))) {
      return parsed.flatMap((item) => item.cards)
    }
    if (parsed.every((item) => item && typeof item === 'object' && Array.isArray(item.cards) && item.cards.length === 1)) {
      return parsed.flatMap((item) => item.cards)
    }
    if (parsed.every((item) => typeof item === 'string')) {
      return parsed.map((prompt) => ({ prompt }))
    }
    if (parsed.every((item) => item && typeof item.prompt === 'string')) {
      return parsed
    }
    return []
  }
  if (Array.isArray(parsed.cards)) return parsed.cards
  return []
}

export function salvagePromptsFromText(text) {
  const matches = [...String(text || '').matchAll(/"prompt"\s*:\s*"((?:\\.|[^"\\])*)"/g)]
  return matches.map((match) => ({ prompt: match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') }))
}

export function parseAiCardBatch(text) {
  const cleaned = extractJsonText(text)
  if (!cleaned) {
    const salvaged = salvagePromptsFromText(text)
    if (salvaged.length) return salvaged
    throw new Error('Empty AI response')
  }
  try {
    const cards = normalizeCardBatch(parseJsonValue(cleaned))
    if (cards.length) return cards
  } catch {
    // fall through to salvage
  }
  const salvaged = salvagePromptsFromText(cleaned || text)
  if (salvaged.length) return salvaged
  throw new Error('Unreadable AI card batch')
}

export function parseAiJsonObject(text) {
  const cleaned = extractJsonText(text)
  if (!cleaned) throw new Error('Empty AI response')
  const parsed = parseJsonValue(cleaned)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  throw new Error('Unreadable AI JSON object')
}
