import { describe, expect, it } from 'vitest'
import { collectResponseText, createResponseText, generateChatGptText, listChatGptModels, pickTextModel } from './chatgpt-responses.js'
import { jsonResponse } from './chatgpt-test-helpers.js'

function sseBody(events, { chunkSize = 7 } = {}) {
  const text = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      // Split mid-event to prove events are reassembled across chunks.
      for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize))
      controller.close()
    }
  })
}

describe('Responses stream parsing', () => {
  it('joins text deltas and succeeds only on response.completed', async () => {
    const body = sseBody([
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: '{"cards":' },
      { type: 'response.output_text.delta', delta: '[{"prompt":"Moon"}]}' },
      { type: 'response.completed', response: {} }
    ])
    await expect(collectResponseText(body)).resolves.toBe('{"cards":[{"prompt":"Moon"}]}')
  })

  it('treats a stream that ends without response.completed as interrupted', async () => {
    await expect(collectResponseText(sseBody([{ type: 'response.output_text.delta', delta: 'partial' }]))).rejects.toMatchObject({ code: 'stream_interrupted' })
  })

  it('surfaces a usage limit hit mid-stream with a manage-usage message', async () => {
    const body = sseBody([
      { type: 'response.output_text.delta', delta: '{' },
      { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } }
    ])
    await expect(collectResponseText(body)).rejects.toMatchObject({ code: 'subscription_sharing_usage_limit_exceeded', usageLimit: true, message: expect.stringMatching(/Usage/) })
  })
})

describe('Responses requests', () => {
  it('sends a streamed, unstored request with a bearer token', async () => {
    let sent
    const fetchImpl = async (url, init) => {
      sent = { url, init }
      return new Response(sseBody([{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed' }]), { status: 200 })
    }
    await expect(createResponseText(fetchImpl, { accessToken: 'at', model: 'gpt-5.5', instructions: 'Be brief.', prompt: 'Hi' })).resolves.toBe('ok')
    expect(sent.url).toBe('https://api.openai.com/v1/responses')
    expect(sent.init.headers.Authorization).toBe('Bearer at')
    expect(JSON.parse(sent.init.body)).toEqual({
      model: 'gpt-5.5', instructions: 'Be brief.', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }], store: false, stream: true
    })
  })

  it('maps admission errors before the stream opens', async () => {
    const fetchImpl = async () => jsonResponse({ error: { code: 'subscription_sharing_user_not_eligible', message: 'nope' } }, 403)
    await expect(createResponseText(fetchImpl, { accessToken: 'at', model: 'm', instructions: '', prompt: '' })).rejects.toMatchObject({ code: 'subscription_sharing_user_not_eligible', status: 403 })
    const unavailable = async () => jsonResponse({ detail: 'direct routing disabled' }, 503)
    await expect(createResponseText(unavailable, { accessToken: 'at', model: 'm', instructions: '', prompt: '' })).rejects.toMatchObject({ status: 503, retryable: true })
  })

  it('lists only listed models from the account catalog and prefers known slugs', async () => {
    const fetchImpl = async () => jsonResponse({ models: [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      { slug: 'internal', visibility: 'hide' },
      { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' }
    ] })
    const models = await listChatGptModels(fetchImpl, 'at')
    expect(models.map((model) => model.slug)).toEqual(['gpt-6.1-sol', 'gpt-5.5'])
    expect(pickTextModel(models, ['gpt-5.5'])).toBe('gpt-5.5')
    expect(pickTextModel(models, ['missing'])).toBe('gpt-6.1-sol')
    expect(pickTextModel([], ['gpt-5.5'])).toBe(null)
  })
})

describe('ChatGPT text generation', () => {
  it('refreshes once and retries when the access token is rejected', async () => {
    const tokens = []
    const session = {
      textModel: null,
      accessToken: async ({ forceRefresh }) => { const token = forceRefresh ? 'fresh' : 'stale'; tokens.push(token); return token },
      fetch: async (url, init = {}) => {
        if (init.headers.Authorization === 'Bearer stale') return new Response('{}', { status: 401 })
        if (url.endsWith('/models')) return jsonResponse({ models: [{ slug: 'gpt-5.5', visibility: 'list' }] })
        return new Response(sseBody([{ type: 'response.output_text.delta', delta: 'cards' }, { type: 'response.completed' }]), { status: 200 })
      }
    }
    await expect(generateChatGptText(session, { instructions: '', prompt: 'p', preferredModels: ['gpt-5.5'] })).resolves.toBe('cards')
    expect(tokens).toEqual(['stale', 'fresh'])
    expect(session.textModel).toBe('gpt-5.5')
  })
})
