import { registerPlugin } from '@capacitor/core'

// The app's own native plugin (ios/App/App/GeminiSecurePlugin.swift and
// android/.../SecureAiPlugin.java): API keys in Keychain / Keystore, native
// Gemini/OpenAI requests, and ChatGPT sign-in support.
export const SecureAi = registerPlugin('SecureAi')
