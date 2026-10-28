import { AI_PROVIDERS, CHATGPT_PROVIDER_ID, CLOUD_AI_PROVIDERS, DEVICE_PROVIDER_ID, isChatGptProviderId, isDeviceProviderId } from './ai-providers.js'

// Which AI providers can generate right now, and which one new decks should
// use. `state` is { deviceReady, keyState: { [cloudId]: boolean }, chatGptConnected }.

export function isProviderAvailable(providerId, { deviceReady = false, keyState = {}, chatGptConnected = false } = {}) {
  if (isDeviceProviderId(providerId)) return deviceReady
  if (isChatGptProviderId(providerId)) return chatGptConnected
  return Boolean(keyState[providerId])
}

export function availableProviders(state) {
  return AI_PROVIDERS.filter((entry) => isProviderAvailable(entry.id, state))
}

// Remote providers in fallback order: saved API keys first (the long-standing
// behaviour), then the ChatGPT account.
export function remoteFallbackProviderId({ keyState = {}, chatGptConnected = false } = {}) {
  const keyed = CLOUD_AI_PROVIDERS.find((entry) => keyState[entry.id])
  if (keyed) return keyed.id
  return chatGptConnected ? CHATGPT_PROVIDER_ID : null
}

// Keeps the chosen provider while it is usable; otherwise prefers on-device,
// then a remote fallback. Leaves the choice alone when nothing is usable so a
// saved preference survives until its provider comes back.
export function resolveActiveProviderId(currentId, state = {}) {
  if (isProviderAvailable(currentId, state)) return currentId
  if (state.deviceReady) return DEVICE_PROVIDER_ID
  return remoteFallbackProviderId(state) || currentId
}
