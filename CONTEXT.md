# Forehead Frenzy — domain glossary

## AI deck generation

- **AI provider** — a source that writes cards (and usually a cover) for a custom deck. There are three kinds, listed in `src/lib/ai-providers.js`:
  - **On-device AI** (`device`) — Apple Intelligence or Gemini Nano through `@capacitor/local-llm`. Native apps only, needs no credentials, and is the default when ready.
  - **API key provider** (`gemini`, `openai`; `CLOUD_AI_PROVIDERS`) — the user pastes their own key. It is stored in iOS Keychain on native and in `localStorage` in the browser.
  - **ChatGPT account** (`chatgpt`) — the user signs in with ChatGPT, and generation is billed to their ChatGPT plan ("ChatGPT plan usage"). Tokens are kept in memory only. Available only where OpenAI's rules allow; see `docs/adr/0001-chatgpt-sign-in-provider.md`.
- **Active provider** — the provider new decks use (setting `aiProvider`). When it isn't available, selection falls back to on-device, then API keys, then ChatGPT (`src/lib/provider-selection.js`).
- **Connected** — a provider that can generate right now: on-device is ready, a key is saved, or a ChatGPT account is signed in *and* granted plan usage.
- **Fallback cover** — the generated SVG cover used when a provider can't make images (on-device outside iOS, ChatGPT) or image generation fails.
