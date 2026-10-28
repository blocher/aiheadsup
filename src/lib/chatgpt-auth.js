// Protocol pieces for "Sign in with ChatGPT" with ChatGPT plan usage, as
// documented for open-source clients at
// https://developers.openai.com/siwc/token-sharing-open-source.
// Endpoints come from https://auth.openai.com/.well-known/openid-configuration.
// Everything here is pure or takes its fetch/crypto as arguments so it can be
// tested without a network. Session state lives in chatgpt-session.js.

export const CHATGPT_AUTH = {
  issuer: 'https://auth.openai.com',
  authorizeUrl: 'https://auth.openai.com/api/accounts/authorize',
  tokenUrl: 'https://auth.openai.com/api/accounts/oauth/token',
  revokeUrl: 'https://auth.openai.com/api/accounts/oauth/revoke',
  // auth.openai.com does not send CORS headers for the JWKS, so the browser
  // reads it through the same-origin proxy configured in vite.config.js.
  jwksUrl: '/openai-auth/jwks.json',
  resource: 'https://api.openai.com/v1',
  // Documented placeholder for first-time dynamic registration. The real
  // client ID (oaiapp_…) is issued per user on the callback.
  dynamicClientId: 'dynamic_agent_client',
  agentName: 'Forehead Frenzy',
  callbackPath: '/auth/callback',
  identityScopes: ['openid', 'profile', 'email'],
  planUsageScopes: ['offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
  planUsageScope: 'chatgpt.tokens.use.direct',
  jwksRemoteUrl: 'https://auth.openai.com/.well-known/jwks.json',
  manageUsageUrl: 'https://chatgpt.com/settings/usage'
}

// Refresh this long before the access token expires.
export const REFRESH_LEEWAY_MS = 60_000
const ID_TOKEN_SKEW_SECONDS = 5
const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused'
])

export class ChatGptAuthError extends Error {
  constructor(message, { code = 'auth_failed', status = null, cause = null } = {}) {
    super(message)
    this.name = 'ChatGptAuthError'
    this.code = code
    this.status = status
    this.cause = cause
  }
}

// OpenAI only accepts an HTTP loopback callback on 127.0.0.1 (not localhost,
// not a custom URL scheme, not a hosted https page). The iOS and Android apps
// serve that callback from a native listener while the sign-in page is open;
// the browser build must itself be served from 127.0.0.1.
// `nativeEnabled` is the VITE_CHATGPT_SIGN_IN build switch.
export function chatGptSignInSupport({ native = false, platform = 'web', location = null, nativeEnabled = true } = {}) {
  if (native) {
    if (platform !== 'ios' && platform !== 'android') {
      return {
        available: false,
        reason: 'platform',
        message: 'ChatGPT sign-in is not available on this platform. Use on-device AI or an API key instead.'
      }
    }
    if (!nativeEnabled) {
      return {
        available: false,
        reason: 'disabled',
        message: 'ChatGPT sign-in is turned off in this build.'
      }
    }
    return { available: true, reason: null, message: '', mode: 'native' }
  }
  const redirectUri = loopbackRedirectUri(location)
  if (!redirectUri) {
    return {
      available: false,
      reason: 'not-loopback',
      message: 'In a browser, ChatGPT sign-in only works when Forehead Frenzy runs locally at http://127.0.0.1 (for example `yarn dev --host 127.0.0.1`). Use the iPhone or Android app, or on-device AI or an API key instead.'
    }
  }
  return { available: true, reason: null, message: '', mode: 'loopback', redirectUri }
}

export function loopbackRedirectUri(location) {
  if (!location || location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return null
  const port = location.port ? `:${location.port}` : ''
  return `http://127.0.0.1${port}${CHATGPT_AUTH.callbackPath}`
}

export function base64UrlEncode(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

export function randomUrlSafe(cryptoImpl, byteLength = 32) {
  return base64UrlEncode(cryptoImpl.getRandomValues(new Uint8Array(byteLength)))
}

export async function createPkcePair(cryptoImpl) {
  // 48 random bytes encode to a 64-character verifier, as in OpenAI's sample.
  const verifier = randomUrlSafe(cryptoImpl, 48)
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

export function createHostId(cryptoImpl) {
  return `urn:uuid:${cryptoImpl.randomUUID()}`
}

export function requestedScopes() {
  return [...CHATGPT_AUTH.identityScopes, ...CHATGPT_AUTH.planUsageScopes].join(' ')
}

export function buildAuthorizeUrl({ clientId, hostId, redirectUri, state, nonce, codeChallenge, idTokenHint = null, loginHint = null, forceConsent = false }) {
  const params = new URLSearchParams()
  params.set('client_id', clientId)
  if (clientId === CHATGPT_AUTH.dynamicClientId) params.set('agent_name_hint', CHATGPT_AUTH.agentName)
  params.set('ext_agent_host_id', hostId)
  if (idTokenHint) params.set('id_token_hint', idTokenHint)
  if (loginHint) params.set('login_hint', loginHint)
  params.set('response_type', 'code')
  params.set('redirect_uri', redirectUri)
  params.set('scope', requestedScopes())
  params.set('resource', CHATGPT_AUTH.resource)
  params.set('state', state)
  params.set('nonce', nonce)
  params.set('code_challenge_method', 'S256')
  params.set('code_challenge', codeChallenge)
  // Only to re-ask for plan usage after the user declined it once.
  if (forceConsent) params.set('prompt', 'consent')
  return `${CHATGPT_AUTH.authorizeUrl}?${params.toString()}`
}

// Validates the loopback callback against the pending attempt and returns the
// authorization code plus the client ID to exchange it with.
export function parseAuthCallback(callbackUrl, pending) {
  if (!pending) throw new ChatGptAuthError('This sign-in link has expired. Start ChatGPT sign-in again.', { code: 'no_pending_sign_in' })
  const params = new URL(callbackUrl).searchParams
  if (params.get('state') !== pending.state) {
    throw new ChatGptAuthError('ChatGPT sign-in could not be verified. Please try again.', { code: 'state_mismatch' })
  }
  const error = params.get('error')
  if (error === 'access_denied') {
    throw new ChatGptAuthError('ChatGPT sign-in was cancelled, or using your ChatGPT plan was not allowed.', { code: 'access_denied' })
  }
  if (error) throw new ChatGptAuthError(params.get('error_description') || `ChatGPT sign-in failed (${error}).`, { code: error })
  const code = params.get('code')
  if (!code) throw new ChatGptAuthError('ChatGPT did not return a sign-in code.', { code: 'missing_code' })
  const returnedClientId = params.get('client_id')
  let clientId
  if (pending.clientId === CHATGPT_AUTH.dynamicClientId) {
    if (!returnedClientId || returnedClientId === CHATGPT_AUTH.dynamicClientId) {
      throw new ChatGptAuthError('ChatGPT did not finish registering Forehead Frenzy. Please try again.', { code: 'registration_incomplete' })
    }
    clientId = returnedClientId
  } else {
    if (returnedClientId && returnedClientId !== pending.clientId) {
      throw new ChatGptAuthError('ChatGPT returned a different app registration than expected. Please try again.', { code: 'client_mismatch' })
    }
    clientId = pending.clientId
  }
  return { code, clientId, scope: params.get('scope') }
}

async function postForm(fetchImpl, url, fields) {
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    })
  } catch (cause) {
    throw new ChatGptAuthError('Could not reach ChatGPT. Check your connection and try again.', { code: 'network_error', cause })
  }
  const text = await response.text()
  let payload = {}
  try { payload = text ? JSON.parse(text) : {} } catch { payload = {} }
  if (!response.ok) {
    const code = payload.error?.code || (typeof payload.error === 'string' ? payload.error : null) || `http_${response.status}`
    const message = payload.error_description || payload.error?.message || `ChatGPT sign-in request failed (${response.status}).`
    throw new ChatGptAuthError(message, { code, status: response.status })
  }
  return payload
}

export function exchangeCode(fetchImpl, { clientId, code, verifier, redirectUri }) {
  return postForm(fetchImpl, CHATGPT_AUTH.tokenUrl, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: CHATGPT_AUTH.resource
  })
}

export function refreshTokens(fetchImpl, { clientId, refreshToken }) {
  // `scope` is omitted on purpose so the existing grant is kept.
  return postForm(fetchImpl, CHATGPT_AUTH.tokenUrl, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    resource: CHATGPT_AUTH.resource
  })
}

export function revokeRefreshToken(fetchImpl, { clientId, refreshToken }) {
  return postForm(fetchImpl, CHATGPT_AUTH.revokeUrl, {
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: clientId
  })
}

export function isTerminalRefreshError(error) {
  return error instanceof ChatGptAuthError && (TERMINAL_REFRESH_ERRORS.has(error.code) || error.code === 'invalid_client')
}

export function isRetryableAuthError(error) {
  return error instanceof ChatGptAuthError && (error.code === 'network_error' || (error.status ?? 0) >= 500)
}

function parseTimestamp(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return parseTimestamp(numeric)
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function scopeList(scope) {
  if (Array.isArray(scope)) return scope
  return typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : []
}

export function hasPlanUsage(scope) {
  return scopeList(scope).includes(CHATGPT_AUTH.planUsageScope)
}

// Turns a token-endpoint response into the in-memory token set. On refresh the
// response may omit the ID token or scope; those carry over from `previous`.
export function tokenSetFromResponse(payload, { now, previous = null } = {}) {
  if (!payload?.access_token) throw new ChatGptAuthError('ChatGPT did not return an access token.', { code: 'missing_access_token' })
  if (!payload.refresh_token && !previous?.refreshToken) {
    throw new ChatGptAuthError('ChatGPT did not return a refresh token.', { code: 'missing_refresh_token' })
  }
  const expiresIn = Number(payload.expires_in)
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previous.refreshToken,
    idToken: payload.id_token || previous?.idToken || null,
    tokenType: payload.token_type || 'Bearer',
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    earliestRefreshAt: parseTimestamp(payload.earliest_refresh_at),
    scopes: payload.scope != null ? scopeList(payload.scope) : (previous?.scopes || [])
  }
}

export function needsRefresh(tokens, now, leewayMs = REFRESH_LEEWAY_MS) {
  if (!tokens) return false
  if (now >= tokens.expiresAt) return true
  if (tokens.earliestRefreshAt && now < tokens.earliestRefreshAt) return false
  return now >= tokens.expiresAt - leewayMs
}

export function decodeJwt(token) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3) throw new ChatGptAuthError('ChatGPT returned a malformed ID token.', { code: 'invalid_id_token' })
  try {
    const decode = (segment) => JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(segment)))
    return { header: decode(parts[0]), payload: decode(parts[1]), signingInput: `${parts[0]}.${parts[1]}`, signature: base64UrlDecodeToBytes(parts[2]) }
  } catch (cause) {
    throw new ChatGptAuthError('ChatGPT returned a malformed ID token.', { code: 'invalid_id_token', cause })
  }
}

// Verifies the RS256 signature against OpenAI's JWKS, then the iss, aud, exp,
// iat and nonce claims. Returns the ID token claims. `nonce` is omitted for an
// ID token returned by a refresh, which carries none of ours.
export async function verifyIdToken(idToken, { jwks, clientId, nonce = undefined, now, cryptoImpl }) {
  const { header, payload, signingInput, signature } = decodeJwt(idToken)
  const fail = (message) => { throw new ChatGptAuthError(message, { code: 'invalid_id_token' }) }
  if (header.alg !== 'RS256') fail('ChatGPT ID token uses an unexpected signing algorithm.')
  const jwk = (jwks?.keys || []).find((key) => key.kid === header.kid)
  if (!jwk) fail('ChatGPT ID token was signed with an unknown key.')
  const key = await cryptoImpl.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await cryptoImpl.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(signingInput))
  if (!valid) fail('ChatGPT ID token signature is invalid.')
  const nowSeconds = Math.floor(now / 1000)
  if (payload.iss !== CHATGPT_AUTH.issuer) fail('ChatGPT ID token has the wrong issuer.')
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(clientId)) fail('ChatGPT ID token was issued for a different app.')
  if (typeof payload.exp !== 'number' || payload.exp + ID_TOKEN_SKEW_SECONDS < nowSeconds) fail('ChatGPT ID token has expired.')
  if (typeof payload.iat !== 'number' || payload.iat - ID_TOKEN_SKEW_SECONDS > nowSeconds) fail('ChatGPT ID token was issued in the future.')
  if (nonce !== undefined && payload.nonce !== nonce) fail('ChatGPT ID token does not match this sign-in attempt.')
  if (!payload.sub) fail('ChatGPT ID token is missing the account identity.')
  return payload
}
