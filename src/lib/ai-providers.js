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

export const CHATGPT_PROVIDER_ID = 'chatgpt'

// Signs in with the user's ChatGPT account and bills generation to their
// ChatGPT plan instead of an API key. See docs/adr/0001-chatgpt-sign-in-provider.md.
export const CHATGPT_AI_PROVIDER = {
  id: CHATGPT_PROVIDER_ID,
  label: 'ChatGPT account',
  short: 'ChatGPT',
  requiresKey: false,
  // The model comes from the signed-in account's own catalog; these are the
  // preferred slugs when that catalog offers them.
  preferredTextModels: ['gpt-5.5'],
  supportsImages: false,
  description: 'Uses your ChatGPT Plus or Pro plan. No API key needed.'
}

export const AI_PROVIDERS = [DEVICE_AI_PROVIDER, ...CLOUD_AI_PROVIDERS, CHATGPT_AI_PROVIDER]

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

export function isChatGptProviderId(id) {
  return id === CHATGPT_PROVIDER_ID
}
