import { describe, expect, it } from 'vitest'
import {
  CHATGPT_AUTH,
  ChatGptAuthError,
  base64UrlEncode,
  buildAuthorizeUrl,
  chatGptSignInSupport,
  createPkcePair,
  hasPlanUsage,
  isTerminalRefreshError,
  needsRefresh,
  parseAuthCallback,
  tokenSetFromResponse,
  verifyIdToken
} from './chatgpt-auth.js'
import { createSigningKey, signIdToken } from './chatgpt-test-helpers.js'

const NOW = Date.UTC(2026, 9, 28, 12)

describe('sign-in support', () => {
  it('uses the native loopback listener in the iOS app unless switched off', () => {
    expect(chatGptSignInSupport({ native: true, platform: 'ios' })).toEqual({ available: true, reason: null, message: '', mode: 'native' })
    expect(chatGptSignInSupport({ native: true, platform: 'ios', nativeEnabled: false })).toMatchObject({ available: false, reason: 'disabled' })
  })

  it('is unavailable in the Android app', () => {
    expect(chatGptSignInSupport({ native: true, platform: 'android' })).toMatchObject({ available: false, reason: 'platform' })
  })

  it('requires the page to be served from the 127.0.0.1 loopback address', () => {
    expect(chatGptSignInSupport({ location: new URL('https://example.com/') })).toMatchObject({ available: false, reason: 'not-loopback' })
    expect(chatGptSignInSupport({ location: new URL('http://localhost:5173/') })).toMatchObject({ available: false })
    expect(chatGptSignInSupport({ location: new URL('http://127.0.0.1:5173/settings') })).toEqual({
      available: true,
      reason: null,
      message: '',
      mode: 'loopback',
      redirectUri: 'http://127.0.0.1:5173/auth/callback'
    })
  })
})

describe('PKCE', () => {
  it('matches the RFC 7636 S256 example', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    expect(base64UrlEncode(new Uint8Array(digest))).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('creates a fresh 64-character verifier and its challenge', async () => {
    const first = await createPkcePair(crypto)
    const second = await createPkcePair(crypto)
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(first.verifier).not.toBe(second.verifier)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.verifier))
    expect(first.challenge).toBe(base64UrlEncode(new Uint8Array(digest)))
  })
})

describe('authorize URL', () => {
  const base = { hostId: 'urn:uuid:host', redirectUri: 'http://127.0.0.1:5173/auth/callback', state: 'st', nonce: 'no', codeChallenge: 'ch' }

  it('registers dynamically on first sign-in with plan-usage scopes', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, clientId: CHATGPT_AUTH.dynamicClientId }))
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.openai.com/api/accounts/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'Forehead Frenzy',
      ext_agent_host_id: 'urn:uuid:host',
      response_type: 'code',
      redirect_uri: base.redirectUri,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      state: 'st',
      nonce: 'no',
      code_challenge_method: 'S256',
      code_challenge: 'ch'
    })
  })

  it('reuses the issued client ID and hints on returning sign-in', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, clientId: 'oaiapp_123', idTokenHint: 'id.tok.en', loginHint: 'a@example.com', forceConsent: true }))
    expect(url.searchParams.get('client_id')).toBe('oaiapp_123')
    expect(url.searchParams.has('agent_name_hint')).toBe(false)
    expect(url.searchParams.get('id_token_hint')).toBe('id.tok.en')
    expect(url.searchParams.get('login_hint')).toBe('a@example.com')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })
})

describe('callback validation', () => {
  const callback = (query) => `http://127.0.0.1:5173/auth/callback?${new URLSearchParams(query)}`
  const firstSignIn = { state: 'st', clientId: CHATGPT_AUTH.dynamicClientId }

  it('takes the issued client ID from a new registration', () => {
    expect(parseAuthCallback(callback({ code: 'c', state: 'st', client_id: 'oaiapp_1' }), firstSignIn)).toMatchObject({ code: 'c', clientId: 'oaiapp_1' })
  })

  it('rejects state mismatches, denials, and incomplete registrations', () => {
    const codeOf = (fn) => { try { fn(); return null } catch (error) { return error.code } }
    expect(codeOf(() => parseAuthCallback(callback({ code: 'c', state: 'other', client_id: 'oaiapp_1' }), firstSignIn))).toBe('state_mismatch')
    expect(codeOf(() => parseAuthCallback(callback({ error: 'access_denied', state: 'st' }), firstSignIn))).toBe('access_denied')
    expect(codeOf(() => parseAuthCallback(callback({ code: 'c', state: 'st' }), firstSignIn))).toBe('registration_incomplete')
    expect(codeOf(() => parseAuthCallback(callback({ code: 'c', state: 'st' }), null))).toBe('no_pending_sign_in')
  })

  it('keeps the saved client ID on reauthorization and rejects a different one', () => {
    const returning = { state: 'st', clientId: 'oaiapp_1' }
    expect(parseAuthCallback(callback({ code: 'c', state: 'st' }), returning).clientId).toBe('oaiapp_1')
    expect(() => parseAuthCallback(callback({ code: 'c', state: 'st', client_id: 'oaiapp_2' }), returning)).toThrow(ChatGptAuthError)
  })
})

describe('token handling', () => {
  const response = { access_token: 'at', refresh_token: 'rt', id_token: 'it', token_type: 'Bearer', expires_in: 3600, scope: 'openid email chatgpt.tokens.use.direct' }

  it('builds a token set with an absolute expiry and granted scopes', () => {
    expect(tokenSetFromResponse(response, { now: NOW })).toEqual({
      accessToken: 'at', refreshToken: 'rt', idToken: 'it', tokenType: 'Bearer', expiresAt: NOW + 3_600_000, earliestRefreshAt: null, scopes: ['openid', 'email', 'chatgpt.tokens.use.direct']
    })
  })

  it('keeps the previous ID token and scopes when a refresh omits them', () => {
    const previous = tokenSetFromResponse(response, { now: NOW })
    const refreshed = tokenSetFromResponse({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }, { now: NOW + 1000, previous })
    expect(refreshed).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2', idToken: 'it', scopes: previous.scopes })
  })

  it('requires an access token and a refresh token', () => {
    expect(() => tokenSetFromResponse({ refresh_token: 'rt' }, { now: NOW })).toThrow(/access token/)
    expect(() => tokenSetFromResponse({ access_token: 'at' }, { now: NOW })).toThrow(/refresh token/)
  })

  it('detects plan usage only from the chatgpt.tokens.use.direct scope', () => {
    expect(hasPlanUsage('openid chatgpt.tokens.use.direct')).toBe(true)
    expect(hasPlanUsage(['openid', 'profile', 'email'])).toBe(false)
    expect(hasPlanUsage(undefined)).toBe(false)
  })

  it('refreshes within a minute of expiry but not before earliest_refresh_at', () => {
    const tokens = { expiresAt: NOW + 3_600_000, earliestRefreshAt: null }
    expect(needsRefresh(tokens, NOW)).toBe(false)
    expect(needsRefresh(tokens, NOW + 3_550_000)).toBe(true)
    expect(needsRefresh(tokens, NOW + 3_600_000)).toBe(true)
    const gated = { expiresAt: NOW + 30_000, earliestRefreshAt: NOW + 50_000 }
    expect(needsRefresh(gated, NOW)).toBe(false)
    expect(needsRefresh(gated, NOW + 31_000)).toBe(true)
    expect(needsRefresh(null, NOW)).toBe(false)
  })

  it('reads earliest_refresh_at in seconds, milliseconds, or ISO form', () => {
    const at = (value) => tokenSetFromResponse({ ...response, earliest_refresh_at: value }, { now: NOW }).earliestRefreshAt
    expect(at(NOW / 1000)).toBe(NOW)
    expect(at(NOW)).toBe(NOW)
    expect(at(new Date(NOW).toISOString())).toBe(NOW)
  })

  it('classifies refresh errors that require signing in again', () => {
    expect(isTerminalRefreshError(new ChatGptAuthError('x', { code: 'invalid_grant' }))).toBe(true)
    expect(isTerminalRefreshError(new ChatGptAuthError('x', { code: 'refresh_token_reused' }))).toBe(true)
    expect(isTerminalRefreshError(new ChatGptAuthError('x', { code: 'network_error' }))).toBe(false)
    expect(isTerminalRefreshError(new Error('invalid_grant'))).toBe(false)
  })
})

describe('ID token verification', () => {
  const claims = (overrides = {}) => ({
    iss: 'https://auth.openai.com', aud: 'oaiapp_1', sub: 'user-1', email: 'a@example.com', nonce: 'no',
    iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 3600, ...overrides
  })

  it('accepts a correctly signed token and returns its claims', async () => {
    const key = await createSigningKey()
    const token = await signIdToken(key, claims())
    await expect(verifyIdToken(token, { jwks: key.jwks, clientId: 'oaiapp_1', nonce: 'no', now: NOW, cryptoImpl: crypto })).resolves.toMatchObject({ sub: 'user-1' })
  })

  it('rejects bad signatures, unknown keys, and mismatched claims', async () => {
    const key = await createSigningKey()
    const other = await createSigningKey('other-key')
    const verify = async (token, overrides = {}) => verifyIdToken(token, { jwks: key.jwks, clientId: 'oaiapp_1', nonce: 'no', now: NOW, cryptoImpl: crypto, ...overrides })
    await expect(verify(await signIdToken({ ...other, kid: key.kid }, claims()))).rejects.toThrow(/signature/)
    await expect(verify(await signIdToken(other, claims()))).rejects.toThrow(/unknown key/)
    await expect(verify(await signIdToken(key, claims({ aud: 'oaiapp_other' })))).rejects.toThrow(/different app/)
    await expect(verify(await signIdToken(key, claims({ iss: 'https://evil.example' })))).rejects.toThrow(/issuer/)
    await expect(verify(await signIdToken(key, claims({ nonce: 'replayed' })))).rejects.toThrow(/sign-in attempt/)
    await expect(verify(await signIdToken(key, claims({ exp: Math.floor(NOW / 1000) - 60 })))).rejects.toThrow(/expired/)
    await expect(verify('not-a-jwt')).rejects.toThrow(/malformed/)
  })

  it('skips the nonce check for an ID token returned by a refresh', async () => {
    const key = await createSigningKey()
    const token = await signIdToken(key, claims({ nonce: undefined }))
    await expect(verifyIdToken(token, { jwks: key.jwks, clientId: 'oaiapp_1', now: NOW, cryptoImpl: crypto })).resolves.toMatchObject({ sub: 'user-1' })
  })
})
