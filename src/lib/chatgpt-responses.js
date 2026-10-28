import { CHATGPT_AUTH } from './chatgpt-auth.js'

// Text generation billed to the user's ChatGPT plan, following
// https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
// and .../errors-and-recovery. Plan usage only covers streamed Responses API
// calls with store:false; image generation is not supported on this route.

const API_BASE = CHATGPT_AUTH.resource

const ERROR_MESSAGES = {
  subscription_sharing_user_not_eligible: 'This ChatGPT account cannot use its plan in other apps. Use on-device AI or an API key instead.',
  subscription_sharing_usage_limit_exceeded: 'You have reached the ChatGPT plan limit for Forehead Frenzy. Open ChatGPT Settings → Usage to manage it.',
  subscription_sharing_usage_unavailable: 'ChatGPT could not check your plan usage right now. Try again in a moment.',
  subscription_sharing_unsupported_capability: 'ChatGPT plan usage does not support this request.',
  subscription_sharing_route_not_supported: 'ChatGPT plan usage does not support this request.',
  subscription_sharing_invalid_user: 'ChatGPT could not validate your account. Try again, or sign in with ChatGPT again in Settings.',
  subscription_sharing_user_unavailable: 'ChatGPT account details are temporarily unavailable. Try again in a moment.',
  chatpass_v2_scope_not_authorized: 'Forehead Frenzy is not allowed to use your ChatGPT plan. Sign out and sign in with ChatGPT again, allowing plan usage.',
  chatpass_v2_invalid_authorization_context: 'Forehead Frenzy is not allowed to use your ChatGPT plan. Sign out and sign in with ChatGPT again, allowing plan usage.'
}

const RETRYABLE_CODES = new Set(['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'])

export class ChatGptRequestError extends Error {
  constructor(message, { code = null, status = null, param = null } = {}) {
    super(message)
    this.name = 'ChatGptRequestError'
    this.code = code
    this.status = status
    this.param = param
    this.retryable = RETRYABLE_CODES.has(code) || status === 503
    this.usageLimit = code === 'subscription_sharing_usage_limit_exceeded'
  }
}

export function describeChatGptError({ code = null, status = null, param = null, detail = null } = {}) {
  if (code && ERROR_MESSAGES[code]) return new ChatGptRequestError(ERROR_MESSAGES[code], { code, status, param })
  if (status === 401) return new ChatGptRequestError('ChatGPT did not accept this sign-in. Sign in with ChatGPT again in Settings.', { code, status })
  if (status === 403) return new ChatGptRequestError(detail ? `ChatGPT blocked this request: ${detail}` : 'ChatGPT blocked this request for this account or region.', { code, status })
  if (status === 503) return new ChatGptRequestError('ChatGPT plan usage is unavailable right now. Try again in a moment.', { code, status })
  return new ChatGptRequestError(detail || `ChatGPT request failed${status ? ` (${status})` : ''}.`, { code, status, param })
}

async function readErrorBody(response) {
  const text = await response.text().catch(() => '')
  try {
    const payload = JSON.parse(text)
    return { code: payload.error?.code || null, param: payload.error?.param || null, detail: payload.error?.message || payload.detail || null }
  } catch {
    return { code: null, param: null, detail: null }
  }
}

export async function listChatGptModels(fetchImpl, accessToken) {
  const response = await fetchImpl(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw describeChatGptError({ status: response.status, ...(await readErrorBody(response)) })
  const payload = await response.json()
  return (payload.models || [])
    .filter((model) => model?.visibility === 'list' && model.slug)
    .map((model) => ({ slug: model.slug, displayName: model.display_name || model.slug }))
}

export function pickTextModel(models, preferred = []) {
  const slugs = models.map((model) => model.slug)
  return preferred.find((slug) => slugs.includes(slug)) || slugs[0] || null
}

// Yields parsed `data:` payloads from a server-sent event stream.
export async function* readSseEvents(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = function* (block) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    try { yield JSON.parse(data) } catch { /* ignore non-JSON keep-alives */ }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let match
    while ((match = buffer.match(/\r?\n\r?\n/))) {
      const block = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      yield* flush(block)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) yield* flush(buffer)
}

// Collects streamed output text. Only `response.completed` counts as success;
// a stream that ends without it is a failure.
export async function collectResponseText(body) {
  let text = ''
  for await (const event of readSseEvents(body)) {
    if (event.type === 'response.output_text.delta') text += event.delta || ''
    else if (event.type === 'response.completed') return text
    else if (event.type === 'response.failed') {
      const error = event.response?.error || {}
      throw describeChatGptError({ code: error.code, param: error.param, detail: error.message })
    } else if (event.type === 'response.incomplete') {
      throw new ChatGptRequestError('ChatGPT stopped before finishing the cards. Please try again.', { code: event.response?.incomplete_details?.reason || 'incomplete' })
    } else if (event.type === 'error') {
      throw describeChatGptError({ code: event.code || event.error?.code, param: event.param, detail: event.message || event.error?.message })
    }
  }
  throw new ChatGptRequestError('The ChatGPT response was interrupted. Please try again.', { code: 'stream_interrupted' })
}

export async function createResponseText(fetchImpl, { accessToken, model, instructions, prompt }) {
  const response = await fetchImpl(`${API_BASE}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      model,
      instructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      store: false,
      stream: true
    })
  })
  if (!response.ok) throw describeChatGptError({ status: response.status, ...(await readErrorBody(response)) })
  if (!response.body) throw new ChatGptRequestError('ChatGPT returned an empty response.', { code: 'empty_response' })
  return collectResponseText(response.body)
}

// Picks a model from the account's catalog (cached per sign-in) and runs one
// prompt. A plain 401 gets one forced token refresh and retry.
export async function generateChatGptText(session, { instructions, prompt, preferredModels = [] }) {
  const run = async (forceRefresh) => {
    const accessToken = await session.accessToken({ forceRefresh })
    if (!session.textModel) {
      session.textModel = pickTextModel(await listChatGptModels(session.fetch, accessToken), preferredModels)
      if (!session.textModel) throw new ChatGptRequestError('Your ChatGPT account has no models available for other apps.', { code: 'no_models' })
    }
    return createResponseText(session.fetch, { accessToken, model: session.textModel, instructions, prompt })
  }
  try {
    return await run(false)
  } catch (error) {
    if (error instanceof ChatGptRequestError && error.status === 401 && !error.code) return run(true)
    throw error
  }
}
