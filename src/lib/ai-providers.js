export const AI_PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    short: 'Gemini',
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

export const DEFAULT_PROVIDER_ID = AI_PROVIDERS[0].id

export function getProvider(id) {
  return AI_PROVIDERS.find((provider) => provider.id === id) || null
}

export function isProviderId(id) {
  return AI_PROVIDERS.some((provider) => provider.id === id)
}
