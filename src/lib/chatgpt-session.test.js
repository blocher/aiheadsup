import { describe, expect, it } from 'vitest'
import { ChatGptSession } from './chatgpt-session.js'
import { CHATGPT_AUTH } from './chatgpt-auth.js'
import { MemoryStorage, createSigningKey, jsonResponse, signIdToken } from './chatgpt-test-helpers.js'

const REDIRECT = 'http://127.0.0.1:5173/auth/callback'
const START = Date.UTC(2026, 9, 28, 12)

// A fake auth.openai.com: records requests and answers from per-endpoint handlers.
async function setup({ scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', sub = 'user-1', refreshIdTokenSub = null, tokenStore = null, jwksLoader = null, storage = new MemoryStorage() } = {}) {
  const key = await createSigningKey()
  const clock = { now: START }
  const requests = []
  const pendingStorage = new MemoryStorage()
  let refreshCount = 0
  const handlers = {
    token: async (form) => {
      if (form.get('grant_type') === 'authorization_code') {
        const authorize = new URL(requests.findLast((entry) => entry.authorize)?.authorize)
        const idToken = await signIdToken(key, {
          iss: CHATGPT_AUTH.issuer, aud: form.get('client_id'), sub, email: 'player@example.com', name: 'Player',
          nonce: authorize.searchParams.get('nonce'), iat: Math.floor(clock.now / 1000), exp: Math.floor(clock.now / 1000) + 3600
        })
        return jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope })
      }
      refreshCount += 1
      const idToken = refreshIdTokenSub && await signIdToken(key, {
        iss: CHATGPT_AUTH.issuer, aud: form.get('client_id'), sub: refreshIdTokenSub, iat: Math.floor(clock.now / 1000), exp: Math.floor(clock.now / 1000) + 3600
      })
      return jsonResponse({ access_token: `access-${refreshCount + 1}`, refresh_token: `refresh-${refreshCount + 1}`, token_type: 'Bearer', expires_in: 3600, ...(idToken ? { id_token: idToken } : {}) })
    },
    revoke: async () => new Response('', { status: 200 })
  }
  const fetchImpl = async (url, init = {}) => {
    const form = init.body ? new URLSearchParams(init.body) : null
    requests.push({ url, form })
    if (url === CHATGPT_AUTH.jwksUrl) return jsonResponse(key.jwks)
    if (url === CHATGPT_AUTH.tokenUrl) return handlers.token(form)
    if (url === CHATGPT_AUTH.revokeUrl) return handlers.revoke(form)
    throw new Error(`unexpected request to ${url}`)
  }
  const changes = []
  const loader = jwksLoader && (() => jwksLoader(key.jwks))
  const session = new ChatGptSession({ fetchImpl, cryptoImpl: crypto, storage, pendingStorage, tokenStore, jwksLoader: loader, now: () => clock.now, sleep: async () => {}, onChange: (status) => changes.push(status) })

  async function signIn(options) {
    const authorize = await session.beginSignIn({ redirectUri: REDIRECT, ...options })
    requests.push({ authorize })
    const params = new URL(authorize).searchParams
    const callback = new URL(REDIRECT)
    callback.searchParams.set('code', 'auth-code')
    callback.searchParams.set('state', params.get('state'))
    if (params.get('client_id') === CHATGPT_AUTH.dynamicClientId) callback.searchParams.set('client_id', 'oaiapp_issued')
    return { authorize: params, status: await session.completeSignIn(callback.toString()) }
  }

  return { session, signIn, key, requests, storage, pendingStorage, clock, handlers, changes, tokenRequests: () => requests.filter((entry) => entry.url === CHATGPT_AUTH.tokenUrl) }
}

describe('ChatGPT session sign-in', () => {
  it('registers, exchanges the code with PKCE, and reports a connected plan', async () => {
    const { signIn, tokenRequests, changes } = await setup()
    const { authorize, status } = await signIn()
    expect(authorize.get('client_id')).toBe('dynamic_agent_client')
    expect(status).toMatchObject({ signedIn: true, planUsage: true, registered: true, email: 'player@example.com' })
    const [exchange] = tokenRequests()
    expect(Object.fromEntries(exchange.form)).toMatchObject({
      grant_type: 'authorization_code', client_id: 'oaiapp_issued', code: 'auth-code', redirect_uri: REDIRECT, resource: 'https://api.openai.com/v1'
    })
    expect(exchange.form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(changes.at(-1).signedIn).toBe(true)
  })

  it('never writes tokens to storage and clears the one-time PKCE record', async () => {
    const { signIn, storage, pendingStorage } = await setup()
    await signIn()
    const saved = storage.values().join('\n')
    expect(saved).toContain('oaiapp_issued')
    expect(saved).not.toMatch(/access-1|refresh-1|eyJ/)
    expect(pendingStorage.values()).toEqual([])
  })

  it('keeps a stable host ID and reuses the issued client ID on the next sign-in', async () => {
    const { session, signIn } = await setup()
    const first = await signIn()
    await session.signOut()
    const second = await signIn()
    expect(second.authorize.get('ext_agent_host_id')).toBe(first.authorize.get('ext_agent_host_id'))
    expect(second.authorize.get('ext_agent_host_id')).toMatch(/^urn:uuid:/)
    expect(second.authorize.get('client_id')).toBe('oaiapp_issued')
    expect(second.authorize.has('agent_name_hint')).toBe(false)
    expect(second.authorize.get('login_hint')).toBe('player@example.com')
  })

  it('stays signed in without plan usage when that permission is declined', async () => {
    const { session, signIn } = await setup({ scope: 'openid profile email offline_access' })
    const { status } = await signIn()
    expect(status).toMatchObject({ signedIn: true, planUsage: false })
    expect(session.isConnected()).toBe(false)
  })

  it('rejects a callback that does not match the pending attempt', async () => {
    const { session } = await setup()
    await session.beginSignIn({ redirectUri: REDIRECT })
    await expect(session.completeSignIn(`${REDIRECT}?code=x&state=forged&client_id=oaiapp_issued`)).rejects.toMatchObject({ code: 'state_mismatch' })
    expect(session.status().signedIn).toBe(false)
  })
})

describe('ChatGPT token refresh', () => {
  it('returns the current access token until it is close to expiry, then refreshes', async () => {
    const { session, signIn, clock, tokenRequests } = await setup()
    await signIn()
    expect(await session.accessToken()).toBe('access-1')
    clock.now += 3_590_000
    expect(await session.accessToken()).toBe('access-2')
    const refresh = tokenRequests().at(-1).form
    expect(Object.fromEntries(refresh)).toEqual({ grant_type: 'refresh_token', client_id: 'oaiapp_issued', refresh_token: 'refresh-1', resource: 'https://api.openai.com/v1' })
    clock.now += 3_590_000
    expect(await session.accessToken()).toBe('access-3')
    expect(tokenRequests().at(-1).form.get('refresh_token')).toBe('refresh-2')
  })

  it('shares one refresh between concurrent callers because refresh tokens rotate', async () => {
    const { session, signIn, tokenRequests } = await setup()
    await signIn()
    const tokens = await Promise.all([session.accessToken({ forceRefresh: true }), session.accessToken({ forceRefresh: true }), session.refresh()])
    expect(tokens.slice(0, 2)).toEqual(['access-2', 'access-2'])
    expect(tokenRequests().filter((entry) => entry.form.get('grant_type') === 'refresh_token')).toHaveLength(1)
  })

  it('signs out locally but keeps the registration when the refresh token is no longer valid', async () => {
    const { session, signIn, handlers } = await setup()
    await signIn()
    handlers.token = async () => jsonResponse({ error: 'invalid_grant', error_description: 'expired' }, 400)
    await expect(session.refresh()).rejects.toMatchObject({ code: 'sign_in_required' })
    expect(session.status()).toMatchObject({ signedIn: false, registered: true, email: 'player@example.com' })
  })

  it('keeps the tokens after a temporary refresh failure', async () => {
    const { session, signIn, handlers } = await setup()
    await signIn()
    handlers.token = async () => jsonResponse({ error: 'server_error' }, 503)
    await expect(session.refresh()).rejects.toMatchObject({ status: 503 })
    expect(session.status().signedIn).toBe(true)
    expect(await session.accessToken()).toBe('access-1')
  })

  it('asks for sign-in when there is no session', async () => {
    const { session } = await setup()
    await expect(session.accessToken()).rejects.toMatchObject({ code: 'sign_in_required' })
  })
})

describe('ChatGPT sign-out', () => {
  it('revokes the refresh token and forgets the tokens', async () => {
    const { session, signIn, requests } = await setup()
    await signIn()
    await expect(session.signOut()).resolves.toEqual({ revoked: true })
    const revoke = requests.find((entry) => entry.url === CHATGPT_AUTH.revokeUrl).form
    expect(Object.fromEntries(revoke)).toEqual({ token: 'refresh-1', token_type_hint: 'refresh_token', client_id: 'oaiapp_issued' })
    expect(session.status()).toMatchObject({ signedIn: false, registered: true })
  })

  it('retries revocation on server errors and still signs out locally if it never confirms', async () => {
    const { session, signIn, handlers, requests } = await setup()
    await signIn()
    handlers.revoke = async () => new Response('', { status: 503 })
    await expect(session.signOut()).resolves.toEqual({ revoked: false })
    expect(requests.filter((entry) => entry.url === CHATGPT_AUTH.revokeUrl)).toHaveLength(3)
    expect(session.status().signedIn).toBe(false)
  })
})

class MemoryTokenStore {
  constructor(value = null) { this.value = value }
  async load() { return this.value }
  async save(value) { this.value = value }
  async clear() { this.value = null }
}

describe('ChatGPT session in the iOS app (Keychain token store)', () => {
  it('saves tokens to the store and restores them on the next launch', async () => {
    const tokenStore = new MemoryTokenStore()
    const storage = new MemoryStorage()
    const first = await setup({ tokenStore, storage })
    await first.signIn()
    expect(JSON.parse(tokenStore.value)).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    expect(first.session.status().persisted).toBe(true)

    const relaunch = await setup({ tokenStore, storage })
    expect(relaunch.session.status().signedIn).toBe(false)
    await expect(relaunch.session.restore()).resolves.toMatchObject({ signedIn: true, planUsage: true, email: 'player@example.com' })
    expect(await relaunch.session.accessToken()).toBe('access-1')
  })

  it('saves the rotated refresh token and clears the store on sign-out', async () => {
    const tokenStore = new MemoryTokenStore()
    const { session, signIn } = await setup({ tokenStore })
    await signIn()
    await session.refresh()
    expect(JSON.parse(tokenStore.value).refreshToken).toBe('refresh-2')
    await session.signOut()
    expect(tokenStore.value).toBe(null)
  })

  it('ignores an unreadable saved session', async () => {
    const { session } = await setup({ tokenStore: new MemoryTokenStore('{not json') })
    await expect(session.restore()).resolves.toMatchObject({ signedIn: false })
  })

  it('loads signing keys through the native loader instead of fetch', async () => {
    const { signIn, requests } = await setup({ jwksLoader: async (jwks) => jwks })
    await expect(signIn()).resolves.toMatchObject({ status: { signedIn: true } })
    expect(requests.some((entry) => entry.url === CHATGPT_AUTH.jwksUrl)).toBe(false)
  })
})

describe('ChatGPT refreshed identity', () => {
  it('accepts a refreshed ID token for the same account', async () => {
    const { session, signIn } = await setup({ refreshIdTokenSub: 'user-1' })
    await signIn()
    await expect(session.refresh()).resolves.toMatchObject({ signedIn: true })
  })

  it('signs out when a refresh returns a different account', async () => {
    const tokenStore = new MemoryTokenStore()
    const { session, signIn } = await setup({ refreshIdTokenSub: 'someone-else', tokenStore })
    await signIn()
    await expect(session.refresh()).rejects.toMatchObject({ code: 'sign_in_required' })
    expect(session.status().signedIn).toBe(false)
    expect(tokenStore.value).toBe(null)
  })
})
