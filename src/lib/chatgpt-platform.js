import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { CHATGPT_AUTH, ChatGptAuthError } from './chatgpt-auth.js'
import { ChatGptSession } from './chatgpt-session.js'
import { SecureAi } from './secure-ai.js'

// Wires the platform-neutral ChatGptSession to this app: in the iOS app tokens
// go to Keychain and the loopback callback is served natively; in the browser
// tokens stay in memory and the page itself is the 127.0.0.1 callback.

const keychainTokenStore = {
  load: async () => (await SecureAi.loadChatGptSession())?.value || null,
  save: (value) => SecureAi.saveChatGptSession({ value }),
  clear: () => SecureAi.clearChatGptSession()
}

// WKWebView fetches are subject to CORS and OpenAI's JWKS sends no CORS
// headers, so the app reads it with Capacitor's native HTTP client.
async function loadJwksNatively() {
  const response = await CapacitorHttp.get({ url: CHATGPT_AUTH.jwksRemoteUrl, headers: { Accept: 'application/json' } })
  if (response.status !== 200) throw new Error(`JWKS request failed (${response.status})`)
  return typeof response.data === 'string' ? JSON.parse(response.data) : response.data
}

let sharedSession = null

export function getChatGptSession() {
  if (!sharedSession) {
    const native = Capacitor.isNativePlatform()
    sharedSession = new ChatGptSession({
      fetchImpl: (...args) => globalThis.fetch(...args),
      cryptoImpl: globalThis.crypto,
      storage: globalThis.localStorage,
      pendingStorage: globalThis.sessionStorage,
      tokenStore: native ? keychainTokenStore : null,
      jwksLoader: native ? loadJwksNatively : null
    })
  }
  return sharedSession
}

// Native sign-in: start the 127.0.0.1 listener, build the authorize URL for
// its port, show the system sign-in sheet, then finish with the callback URL.
export async function signInNatively(session, { forceConsent = false } = {}) {
  const { redirectUri } = await SecureAi.prepareChatGptCallback()
  const url = await session.beginSignIn({ redirectUri, forceConsent })
  let callbackUrl
  try {
    ({ callbackUrl } = await SecureAi.openChatGptAuthorization({ url }))
  } catch (error) {
    throw new ChatGptAuthError(error?.message || 'ChatGPT sign-in was cancelled.', { code: error?.code === 'cancelled' ? 'cancelled' : 'auth_failed', cause: error })
  }
  return session.completeSignIn(callbackUrl)
}
