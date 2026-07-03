export const DEVICE_PROVIDER_ID = 'device'

export const DEVICE_AI_PROVIDER = {
  id: DEVICE_PROVIDER_ID,
  label: 'On-Device AI',
  short: 'On-Device',
  requiresKey: false,
  textModel: 'on-device',
  imageModel: 'on-device',
  description: 'Private generation on your phone — Apple Intelligence on iOS 26+ or Gemini Nano on supported Android.'
}

export const CLOUD_AI_PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    short: 'Gemini',
    requiresKey: true,
    textModel: 'gemini-3.5-flash',
    imageModel: 'gemini-3.1-flash-image',
    keyPrefixHint: 'Starts with "AIza…"',
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
    keyHelpSteps: [
      'Open Google AI Studio and sign in with a Google account.',
      'Go to “Get API key” and create a key in a new or existing project.',
      'Copy the key (it starts with “AIza”) and paste it here.'
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    short: 'OpenAI',
    requiresKey: true,
    textModel: 'gpt-5.5',
    imageModel: 'gpt-image-2',
    keyPrefixHint: 'Starts with "sk-…"',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    keyHelpSteps: [
      'Sign in at platform.openai.com and open the “API keys” page.',
      'Click “Create new secret key”, then copy it (it starts with “sk-”).',
      'Add billing or credits to your OpenAI account, then paste the key here.'
    ]
  }
]

export const AI_PROVIDERS = [DEVICE_AI_PROVIDER, ...CLOUD_AI_PROVIDERS]

export const DEFAULT_PROVIDER_ID = DEVICE_PROVIDER_ID
export const DEFAULT_CLOUD_PROVIDER_ID = CLOUD_AI_PROVIDERS[0].id

export function getProvider(id) {
  return AI_PROVIDERS.find((provider) => provider.id === id) || null
}

export function isProviderId(id) {
  return AI_PROVIDERS.some((provider) => provider.id === id)
}

export function isCloudProviderId(id) {
  return CLOUD_AI_PROVIDERS.some((provider) => provider.id === id)
}

export function isDeviceProviderId(id) {
  return id === DEVICE_PROVIDER_ID
}
