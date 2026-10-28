# 0002 — ChatGPT sign-in in the iOS app through a native loopback listener

Status: accepted (2026-10-28). Supersedes the "native apps: not yet available" part of [0001](0001-chatgpt-sign-in-provider.md).

## Context

OpenAI's ChatGPT plan-usage sign-in only redirects to `http://127.0.0.1:<port>/auth/callback`. App URL schemes aren't accepted. OpenAI's [Sign in with ChatGPT cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) and [devkit](https://github.com/openai/sign-in-with-chatgpt-devkit) show the intended pattern: the app starts a callback listener on `127.0.0.1`, opens the system browser, and catches the redirect itself. The cookbook names "open-source projects, personal projects that run locally, and selected private apps" as eligible. Paid or remotely hosted apps join a waitlist first.

## Decision

- **Sign-in on iOS.** The `SecureAi` plugin (`ios/App/App/GeminiSecurePlugin.swift`) gets three steps:
  - `prepareChatGptCallback` starts an `NWListener` bound to `127.0.0.1` on a free port and returns the redirect URI.
  - JS builds the authorize URL for that port with `ChatGptSession.beginSignIn`.
  - `openChatGptAuthorization` shows it in `ASWebAuthenticationSession` (the system browser; it shares Safari's ChatGPT login). The app stays in the foreground, so the sheet's redirect reaches the listener. The listener accepts only `GET /auth/callback` with `Host: 127.0.0.1:<port>` and this attempt's `state`, answers with a short "Return to Forehead Frenzy" page, and the sheet is closed.

  Everything else — code exchange, ID-token checks, refresh, revoke, inference — is the same JS used in the browser (`chatgpt-session.js`, `chatgpt-responses.js`). The wiring lives in `chatgpt-platform.js`.
- **Tokens persist in the iOS Keychain** (`saveChatGptSession` / `loadChatGptSession` / `clearChatGptSession`; `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), so the user stays signed in across launches. Unlike API keys, the tokens pass through the WebView's memory, because the requests are made from JS. They are never written to WebView storage. Rotated refresh tokens are saved before they are used.
- **The JWKS is fetched with `CapacitorHttp`** (native HTTP), since OpenAI's JWKS sends no CORS headers. The token, revoke and API endpoints do allow CORS, so `fetch` works for those.
- **Refreshed ID tokens are checked.** A refresh can return a new ID token. It is verified (no nonce) and must name the same account, or the session ends.
- **Android** got the same design in [0003](0003-android-secure-ai-plugin.md).
- **Build switch: `VITE_CHATGPT_SIGN_IN=off`** hides the feature. It's on by default, for the developer's own device builds.

## Consequences

- No URL scheme, intent filter or entitlement is needed, and none was added.
- Not yet run on a device. The Swift could not be compiled in the environment where it was written, and nothing has been tested against a live ChatGPT account. Device risks:
  - `NWListener` on loopback: binding to loopback should not trigger iOS's local-network permission prompt.
  - `ASWebAuthenticationSession` loading an `http://127.0.0.1` page.
  - The sheet closing itself after the callback.
- **App Store / TestFlight distribution needs OpenAI's approval** ([interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)). Until then, build those releases with `VITE_CHATGPT_SIGN_IN=off`.
