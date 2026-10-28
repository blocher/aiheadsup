import {
  CHATGPT_AUTH,
  ChatGptAuthError,
  buildAuthorizeUrl,
  createHostId,
  createPkcePair,
  exchangeCode,
  hasPlanUsage,
  isRetryableAuthError,
  isTerminalRefreshError,
  needsRefresh,
  parseAuthCallback,
  randomUrlSafe,
  refreshTokens,
  revokeRefreshToken,
  tokenSetFromResponse,
  verifyIdToken
} from './chatgpt-auth.js'

const REGISTRATION_KEY = 'forehead-frenzy.chatgpt-registration'
const HOST_ID_KEY = 'forehead-frenzy.chatgpt-host-id'
const PENDING_KEY = 'forehead-frenzy.chatgpt-pending-sign-in'
const REVOKE_ATTEMPTS = 3

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(storage, key, value) {
  if (value == null) storage?.removeItem(key)
  else storage?.setItem(key, JSON.stringify(value))
}

function isTokenSet(value) {
  return Boolean(value && typeof value.accessToken === 'string' && typeof value.refreshToken === 'string' && Number.isFinite(value.expiresAt) && Array.isArray(value.scopes))
}

// One ChatGPT account per app install. OpenAI asks clients to keep access,
// refresh and ID tokens out of browser storage: `storage` holds just the
// non-secret registration (issued client ID, host ID, account email) and
// `pendingStorage` the PKCE verifier for one sign-in round trip. Tokens live in
// memory, and are also written to `tokenStore` (iOS Keychain) when one is
// given; in the browser there is none, so tokens last only for the tab.
export class ChatGptSession {
  constructor({ fetchImpl, cryptoImpl, storage, pendingStorage, tokenStore = null, jwksLoader = null, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onChange = null } = {}) {
    this.fetch = fetchImpl
    this.crypto = cryptoImpl
    this.storage = storage
    this.pendingStorage = pendingStorage
    this.tokenStore = tokenStore
    this.jwksLoader = jwksLoader
    this.now = now
    this.sleep = sleep
    this.onChange = onChange
    this.tokens = null
    this.refreshInFlight = null
    this.textModel = null
  }

  // Loads tokens saved by an earlier launch. A refresh happens on first use.
  async restore() {
    if (!this.tokenStore || this.tokens) return this.status()
    try {
      const saved = JSON.parse((await this.tokenStore.load()) || 'null')
      if (isTokenSet(saved) && this.registration()?.clientId) this.tokens = saved
    } catch {
      // Unreadable or missing: stay signed out.
    }
    this.emitChange()
    return this.status()
  }

  async persistTokens() {
    if (!this.tokenStore) return
    try {
      if (this.tokens) await this.tokenStore.save(JSON.stringify(this.tokens))
      else await this.tokenStore.clear()
    } catch {
      // Keep working from memory; the next launch will ask to sign in again.
    }
  }

  registration() {
    return readJson(this.storage, REGISTRATION_KEY)
  }

  hostId() {
    let hostId = this.storage?.getItem(HOST_ID_KEY)
    if (!hostId) {
      hostId = createHostId(this.crypto)
      this.storage?.setItem(HOST_ID_KEY, hostId)
    }
    return hostId
  }

  status() {
    const registration = this.registration()
    const signedIn = Boolean(this.tokens)
    return {
      signedIn,
      planUsage: signedIn && hasPlanUsage(this.tokens.scopes),
      registered: Boolean(registration?.clientId),
      email: registration?.email || '',
      name: registration?.name || '',
      expiresAt: this.tokens?.expiresAt || null,
      persisted: Boolean(this.tokenStore)
    }
  }

  isConnected() {
    const { signedIn, planUsage } = this.status()
    return signedIn && planUsage
  }

  emitChange() {
    this.onChange?.(this.status())
  }

  // Returns the authorize URL to open. `forceConsent` re-asks for plan usage
  // after the user declined it.
  async beginSignIn({ redirectUri, forceConsent = false }) {
    const registration = this.registration()
    const clientId = registration?.clientId || CHATGPT_AUTH.dynamicClientId
    const { verifier, challenge } = await createPkcePair(this.crypto)
    const pending = {
      state: randomUrlSafe(this.crypto),
      nonce: randomUrlSafe(this.crypto),
      verifier,
      redirectUri,
      clientId
    }
    writeJson(this.pendingStorage, PENDING_KEY, pending)
    return buildAuthorizeUrl({
      clientId,
      hostId: this.hostId(),
      redirectUri,
      state: pending.state,
      nonce: pending.nonce,
      codeChallenge: challenge,
      idTokenHint: this.tokens?.idToken || null,
      loginHint: registration?.email || null,
      forceConsent
    })
  }

  async completeSignIn(callbackUrl) {
    const pending = readJson(this.pendingStorage, PENDING_KEY)
    writeJson(this.pendingStorage, PENDING_KEY, null)
    const { code, clientId } = parseAuthCallback(callbackUrl, pending)
    const payload = await exchangeCode(this.fetch, { clientId, code, verifier: pending.verifier, redirectUri: pending.redirectUri })
    const tokens = tokenSetFromResponse(payload, { now: this.now() })
    if (!tokens.idToken) throw new ChatGptAuthError('ChatGPT did not return an ID token.', { code: 'invalid_id_token' })
    const claims = await verifyIdToken(tokens.idToken, { jwks: await this.loadJwks(), clientId, nonce: pending.nonce, now: this.now(), cryptoImpl: this.crypto })
    const previous = this.registration()
    if (previous?.clientId === clientId && previous.subject && previous.subject !== claims.sub) {
      throw new ChatGptAuthError('That ChatGPT account does not match the one this app was registered with. Sign out first to switch accounts.', { code: 'account_mismatch' })
    }
    writeJson(this.storage, REGISTRATION_KEY, {
      clientId,
      subject: claims.sub,
      email: claims.email || previous?.email || '',
      name: claims.name || previous?.name || ''
    })
    this.tokens = tokens
    this.textModel = null
    await this.persistTokens()
    this.emitChange()
    return this.status()
  }

  async loadJwks() {
    if (this.jwksLoader) {
      try {
        return await this.jwksLoader()
      } catch (cause) {
        throw new ChatGptAuthError('Could not load OpenAI signing keys to verify sign-in.', { code: 'jwks_unavailable', cause })
      }
    }
    let response
    try {
      response = await this.fetch(CHATGPT_AUTH.jwksUrl)
    } catch (cause) {
      throw new ChatGptAuthError('Could not load OpenAI signing keys to verify sign-in.', { code: 'jwks_unavailable', cause })
    }
    if (!response.ok) throw new ChatGptAuthError('Could not load OpenAI signing keys to verify sign-in.', { code: 'jwks_unavailable', status: response.status })
    return response.json()
  }

  // A valid access token, refreshing first when it is close to expiry.
  async accessToken({ forceRefresh = false } = {}) {
    if (!this.tokens) throw new ChatGptAuthError('Sign in with ChatGPT in Settings first.', { code: 'sign_in_required' })
    if (forceRefresh || needsRefresh(this.tokens, this.now())) await this.refresh()
    return this.tokens.accessToken
  }

  // Refresh tokens rotate, so concurrent callers share one in-flight refresh.
  refresh() {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh().finally(() => { this.refreshInFlight = null })
    }
    return this.refreshInFlight
  }

  async doRefresh() {
    const registration = this.registration()
    if (!this.tokens || !registration?.clientId) throw new ChatGptAuthError('Sign in with ChatGPT in Settings first.', { code: 'sign_in_required' })
    try {
      const payload = await refreshTokens(this.fetch, { clientId: registration.clientId, refreshToken: this.tokens.refreshToken })
      // The old refresh token is spent now, so save the rotated set first.
      this.tokens = tokenSetFromResponse(payload, { now: this.now(), previous: this.tokens })
      await this.persistTokens()
      if (payload.id_token) await this.checkRefreshedIdentity(payload.id_token, registration)
      this.emitChange()
      return this.status()
    } catch (error) {
      if (isTerminalRefreshError(error) || error?.code === 'account_mismatch') {
        // The session is gone (expired, revoked, or disconnected in ChatGPT).
        // Keep the registration so signing in again reuses the client ID.
        this.tokens = null
        await this.persistTokens()
        this.emitChange()
        throw new ChatGptAuthError('Your ChatGPT session ended. Sign in with ChatGPT again in Settings.', { code: 'sign_in_required', cause: error })
      }
      // Network and server errors keep the tokens for a later retry.
      throw error
    }
  }

  // A refresh may return a new ID token; it must still be OpenAI's and name
  // the same account. If the signing keys can't be fetched right now, the
  // rotated tokens are kept and the check is skipped.
  async checkRefreshedIdentity(idToken, registration) {
    let jwks
    try {
      jwks = await this.loadJwks()
    } catch {
      return
    }
    let claims
    try {
      claims = await verifyIdToken(idToken, { jwks, clientId: registration.clientId, now: this.now(), cryptoImpl: this.crypto })
    } catch (error) {
      throw new ChatGptAuthError(error.message, { code: 'account_mismatch', cause: error })
    }
    if (registration.subject && claims.sub !== registration.subject) {
      throw new ChatGptAuthError('The refreshed ChatGPT identity does not match this account.', { code: 'account_mismatch' })
    }
  }

  // Revokes the refresh token, then forgets the tokens either way. The
  // registration and host ID stay so the next sign-in reuses them.
  async signOut() {
    const registration = this.registration()
    const tokens = this.tokens
    this.tokens = null
    this.textModel = null
    await this.persistTokens()
    this.emitChange()
    if (!tokens || !registration?.clientId) return { revoked: true }
    for (let attempt = 1; attempt <= REVOKE_ATTEMPTS; attempt += 1) {
      try {
        await revokeRefreshToken(this.fetch, { clientId: registration.clientId, refreshToken: tokens.refreshToken })
        return { revoked: true }
      } catch (error) {
        if (!isRetryableAuthError(error) || attempt === REVOKE_ATTEMPTS) return { revoked: false }
        await this.sleep(500 * 2 ** (attempt - 1))
      }
    }
    return { revoked: false }
  }
}
