import { describe, expect, it } from 'vitest'
import { availableProviders, isProviderAvailable, remoteFallbackProviderId, resolveActiveProviderId } from './provider-selection.js'
import { AI_PROVIDERS, CHATGPT_PROVIDER_ID, CLOUD_AI_PROVIDERS, DEVICE_PROVIDER_ID, getProvider, isChatGptProviderId } from './ai-providers.js'

const none = { deviceReady: false, keyState: {}, chatGptConnected: false }

describe('provider registry', () => {
  it('adds ChatGPT as a third kind of provider without changing the key-based ones', () => {
    expect(AI_PROVIDERS.map((entry) => entry.id)).toEqual([DEVICE_PROVIDER_ID, 'gemini', 'openai', CHATGPT_PROVIDER_ID])
    expect(CLOUD_AI_PROVIDERS.some((entry) => entry.id === CHATGPT_PROVIDER_ID)).toBe(false)
    expect(getProvider(CHATGPT_PROVIDER_ID)).toMatchObject({ requiresKey: false, supportsImages: false })
    expect(isChatGptProviderId('chatgpt')).toBe(true)
    expect(isChatGptProviderId('openai')).toBe(false)
  })
})

describe('provider availability', () => {
  it('treats each provider kind by its own readiness signal', () => {
    const state = { deviceReady: true, keyState: { gemini: true }, chatGptConnected: false }
    expect(isProviderAvailable(DEVICE_PROVIDER_ID, state)).toBe(true)
    expect(isProviderAvailable('gemini', state)).toBe(true)
    expect(isProviderAvailable('openai', state)).toBe(false)
    expect(isProviderAvailable(CHATGPT_PROVIDER_ID, state)).toBe(false)
    expect(isProviderAvailable(CHATGPT_PROVIDER_ID, { ...state, chatGptConnected: true })).toBe(true)
  })

  it('lists available providers in registry order', () => {
    const state = { deviceReady: true, keyState: { openai: true }, chatGptConnected: true }
    expect(availableProviders(state).map((entry) => entry.id)).toEqual([DEVICE_PROVIDER_ID, 'openai', CHATGPT_PROVIDER_ID])
    expect(availableProviders(none)).toEqual([])
  })
})

describe('active provider resolution', () => {
  it('keeps the chosen provider while it is usable', () => {
    expect(resolveActiveProviderId(CHATGPT_PROVIDER_ID, { deviceReady: true, keyState: {}, chatGptConnected: true })).toBe(CHATGPT_PROVIDER_ID)
    expect(resolveActiveProviderId('openai', { deviceReady: true, keyState: { openai: true } })).toBe('openai')
  })

  it('prefers on-device, then saved keys, then ChatGPT when the choice is unusable', () => {
    expect(resolveActiveProviderId(CHATGPT_PROVIDER_ID, { deviceReady: true, keyState: { gemini: true }, chatGptConnected: false })).toBe(DEVICE_PROVIDER_ID)
    expect(resolveActiveProviderId(DEVICE_PROVIDER_ID, { deviceReady: false, keyState: { openai: true }, chatGptConnected: true })).toBe('openai')
    expect(resolveActiveProviderId(DEVICE_PROVIDER_ID, { deviceReady: false, keyState: {}, chatGptConnected: true })).toBe(CHATGPT_PROVIDER_ID)
  })

  it('leaves a saved preference alone when nothing is usable', () => {
    expect(resolveActiveProviderId(CHATGPT_PROVIDER_ID, none)).toBe(CHATGPT_PROVIDER_ID)
    expect(resolveActiveProviderId(DEVICE_PROVIDER_ID, none)).toBe(DEVICE_PROVIDER_ID)
  })

  it('falls back from on-device to keys before ChatGPT', () => {
    expect(remoteFallbackProviderId({ keyState: { gemini: true }, chatGptConnected: true })).toBe('gemini')
    expect(remoteFallbackProviderId({ keyState: {}, chatGptConnected: true })).toBe(CHATGPT_PROVIDER_ID)
    expect(remoteFallbackProviderId(none)).toBe(null)
  })
})
