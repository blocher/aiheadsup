import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS, CLOUD_AI_PROVIDERS, DEFAULT_PROVIDER_ID, DEVICE_PROVIDER_ID, getProvider, isCloudProviderId, isDeviceProviderId } from './ai-providers.js'
import { deviceBadgeLabel, deviceStatusHint, deviceStatusLabel } from './local-llm.js'

describe('ai providers', () => {
  it('lists on-device first and keeps cloud providers key-based', () => {
    expect(AI_PROVIDERS[0].id).toBe(DEVICE_PROVIDER_ID)
    expect(AI_PROVIDERS[0].requiresKey).toBe(false)
    expect(CLOUD_AI_PROVIDERS.every((entry) => entry.requiresKey)).toBe(true)
    expect(DEFAULT_PROVIDER_ID).toBe(DEVICE_PROVIDER_ID)
    expect(getProvider('gemini')?.short).toBe('Gemini')
    expect(isDeviceProviderId('device')).toBe(true)
    expect(isCloudProviderId('openai')).toBe(true)
  })
})

describe('local llm status copy', () => {
  it('explains browser limitations clearly', () => {
    expect(deviceStatusLabel('unavailable', { webBuild: true })).toContain('browser')
    expect(deviceStatusHint('unavailable', { webBuild: true })).toMatch(/Safari|browser/i)
  })

  it('distinguishes loading from unavailable', () => {
    expect(deviceBadgeLabel('notready', { webBuild: false })).toBe('Loading')
    expect(deviceBadgeLabel('available', { webBuild: false })).toBe('Ready')
    expect(deviceStatusHint('notready', { platform: 'ios', webBuild: false })).toMatch(/loading/i)
    expect(deviceStatusHint('unavailable', { platform: 'ios', webBuild: false, reason: 'LOCAL_LLM_NOT_ENABLED' })).toMatch(/Settings app/i)
    expect(deviceStatusHint('unavailable', { platform: 'ios', webBuild: false, reason: 'UNIMPLEMENTED' })).toMatch(/cap sync ios/i)
  })
})
