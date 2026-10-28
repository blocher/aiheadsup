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

// One ChatGPT account per app install. OpenAI asks clients to keep access,
// refresh and ID tokens out of browser storage, so they live only in memory:
// `storage` holds just the non-secret registration (issued client ID, host ID,
// account email) and `pendingStorage` holds the PKCE verifier for the single
// redirect round trip.
export class ChatGptSession {
  constructor({ fetchImpl, cryptoImpl, storage, pendingStorage, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onChange = null } = {}) {
    this.fetch = fetchImpl
    this.crypto = cryptoImpl
    this.storage = storage
    this.pendingStorage = pendingStorage
    this.now = now
    this.sleep = sleep
    this.onChange = onChange
    this.tokens = null
    this.refreshInFlight = null
    this.textModel = null
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
      expiresAt: this.tokens?.expiresAt || null
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
    this.emitChange()
    return this.status()
  }

  async loadJwks() {
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
      this.tokens = tokenSetFromResponse(payload, { now: this.now(), previous: this.tokens })
      this.emitChange()
      return this.status()
    } catch (error) {
      if (isTerminalRefreshError(error)) {
        // The session is gone (expired, revoked, or disconnected in ChatGPT).
        // Keep the registration so signing in again reuses the client ID.
        this.tokens = null
        this.emitChange()
        throw new ChatGptAuthError('Your ChatGPT session ended. Sign in with ChatGPT again in Settings.', { code: 'sign_in_required', cause: error })
      }
      // Network and server errors keep the tokens for a later retry.
      throw error
    }
  }

  // Revokes the refresh token, then forgets the tokens either way. The
  // registration and host ID stay so the next sign-in reuses them.
  async signOut() {
    const registration = this.registration()
    const tokens = this.tokens
    this.tokens = null
    this.textModel = null
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

let sharedSession = null

export function getChatGptSession() {
  if (!sharedSession) {
    sharedSession = new ChatGptSession({
      fetchImpl: (...args) => globalThis.fetch(...args),
      cryptoImpl: globalThis.crypto,
      storage: globalThis.localStorage,
      pendingStorage: globalThis.sessionStorage
    })
  }
  return sharedSession
}
