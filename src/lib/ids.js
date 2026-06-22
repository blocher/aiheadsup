export function createId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`
}

export function normalizePrompt(prompt) {
  return prompt.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
