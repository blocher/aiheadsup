# 0001 — ChatGPT account as a third AI provider

Status: accepted (2026-10-28); native iOS part superseded by [0002](0002-ios-chatgpt-sign-in-loopback.md)

## Context

Deck generation had two kinds of **AI provider**: **on-device** (`@capacitor/local-llm`) and **API key** providers (Gemini, OpenAI; keys in iOS Keychain via the `SecureAi` plugin, or `localStorage` in the browser). We wanted a third kind: sign in with a ChatGPT account and bill generation to the user's ChatGPT plan.

OpenAI documents this as "Sign in with ChatGPT" with "ChatGPT plan usage" ([overview](https://developers.openai.com/siwc/token-sharing-open-source), [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)). The parts that shape this design, as of 2026-10-28:

- Plan usage is self-serve only for **open-source and locally hosted** apps. Paid or remotely hosted apps go through an [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/). This repository is public.
- Clients register dynamically: the first authorize request uses `client_id=dynamic_agent_client`, and the callback returns a per-user `oaiapp_…` client ID. No client secret, no shared app ID.
- The redirect must be an **HTTP loopback callback on `127.0.0.1`**, with a fixed path and only the port allowed to vary. Custom URL schemes, universal links and hosted `https` callbacks are not documented.
- Tokens go in protected storage and "out of browser storage". Access tokens last 1 hour. Refresh tokens last 30 days and rotate on every refresh.
- Inference is `POST /v1/responses` only, with `store:false` and `stream:true`. Image generation is not supported, and neither are `temperature` or `max_output_tokens`.

## Decision

1. **A separate provider kind.** `chatgpt` is listed in `AI_PROVIDERS` but not in `CLOUD_AI_PROVIDERS`, since that list means "needs an API key". Availability and fallback live in `src/lib/provider-selection.js`. On-device stays the default. When the chosen provider can't run, the order is on-device, then saved keys, then ChatGPT, so existing setups behave exactly as before.
2. **Only where OpenAI's rules allow it.** `chatGptSignInSupport()` turns sign-in on only for a web build served from `http://127.0.0.1:<port>`, which then acts as its own loopback callback at `/auth/callback`. The iOS/Android apps and hosted web builds show the provider as "Not yet available" and say why. We did not add an app URL scheme (Info.plist `CFBundleURLTypes`, Android intent filter). OpenAI would reject it as a `redirect_uri`, and a native loopback listener would be an undocumented workaround for an App Store app that isn't eligible anyway.
3. **Tokens in memory only.** Unlike API keys, ChatGPT tokens never touch `localStorage`, as OpenAI asks. Only non-secret registration data is saved: issued client ID, `ext_agent_host_id` (`urn:uuid:…`), and account email/subject. The PKCE verifier sits in `sessionStorage` for the one redirect round trip and is deleted when the callback arrives. The cost: after a page reload the user has to click "Continue with ChatGPT" again. Returning sign-in reuses the saved client ID and skips consent.
4. **Follow the documented protocol exactly** (`src/lib/chatgpt-auth.js`, `chatgpt-session.js`):
   - PKCE S256 with fresh `state` and `nonce` on every attempt.
   - ID token checked against OpenAI's JWKS (RS256 signature, `iss`, `aud`, `exp`, `iat`, `nonce`). The JWKS has no CORS headers, so the Vite dev/preview server proxies it at `/openai-auth/jwks.json`.
   - Plan usage counts only if the granted scope includes `chatgpt.tokens.use.direct`. Otherwise the account stays signed in, shows "Plan use off", and offers to ask again with `prompt=consent`.
   - Refreshes run one at a time, because refresh tokens rotate. Terminal refresh errors clear the tokens but keep the registration. Network and 5xx errors keep the tokens.
   - Sign-out revokes the refresh token, retrying with backoff, then clears the tokens locally either way and tells the user if revocation wasn't confirmed.
5. **Generation** (`src/lib/chatgpt-responses.js`):
   - The model comes from the account's `GET /v1/models` catalog, preferring `gpt-5.5`.
   - Streamed output text is collected, and only `response.completed` counts as success.
   - The documented `subscription_sharing_*` error codes map to plain messages; a usage-limit error points to ChatGPT Settings → Usage.
   - ChatGPT decks use the generated SVG cover, because plan usage doesn't cover image generation.

## Consequences

- Existing on-device and API-key behaviour is unchanged.
- ChatGPT sign-in works today only for someone running the app locally (`yarn dev --host 127.0.0.1` or `yarn preview --host 127.0.0.1`). It is not tested against a live ChatGPT account. The browser test stubs OpenAI's endpoints.
- Turning it on for the iOS/Android apps or a hosted web build needs OpenAI's approval (interest form) and an officially supported mobile or hosted redirect. When that exists, add the redirect to `chatGptSignInSupport()`, add native URL handling and config, and move native token storage to Keychain. See `.scratch/chatgpt-login/`.
- The "Manage usage" link goes to `https://chatgpt.com/settings/usage`, as given in OpenAI's [Sign in with ChatGPT cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).
