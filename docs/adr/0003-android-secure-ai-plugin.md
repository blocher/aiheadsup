# 0003 — Android SecureAi plugin (API keys and ChatGPT sign-in)

Status: accepted (2026-10-28)

## Context

The JS calls `SecureAi` (save/use API keys, native Gemini/OpenAI requests, and the ChatGPT sign-in hooks from [0002](0002-ios-chatgpt-sign-in-loopback.md)) on every native platform. Only iOS implemented it. On Android, `MainActivity` registered nothing, so saving or using a Gemini/OpenAI key failed, and ChatGPT sign-in was switched off.

## Decision

Add `android/app/src/main/java/com/benjaminlocher/foreheadfrenzy/SecureAiPlugin.java` with the same JS name, methods and result shapes as the Swift plugin, and register it in `MainActivity`.

- **Secrets** (`SecretStore.java`):
  - Encrypted with an AES-256-GCM key that lives in Android Keystore; the ciphertext is kept in private SharedPreferences.
  - If the key is lost (reinstall, or restore from a backup), the entry reads as missing.
  - No dependency was added for this; `androidx.security:security-crypto` is deprecated.
- **Gemini/OpenAI calls** use `HttpURLConnection`, with the same endpoints, bodies, timeouts and error messages as iOS.
- **ChatGPT sign-in:**
  - `ChatGptLoopbackServer.java` is plain Java and covered by JVM unit tests. It binds `127.0.0.1` on a free port and accepts only `GET /auth/callback` with `Host: 127.0.0.1:<port>` and this attempt's `state`.
  - The sign-in page opens in a Chrome Custom Tab (`androidx.browser:browser:1.9.0`), falling back to the default browser.
  - Android apps keep running in the background, so the listener receives the redirect.
  - The app then tries to bring itself to the front. Android 15+ may block that, so the callback page also shows a **Return to Forehead Frenzy** button. It uses an `intent://` link to a new `com.benjaminlocher.foreheadfrenzy://chatgpt-return` intent filter. That filter only reopens the app; the OAuth redirect stays on 127.0.0.1.
  - Returning to the app without a callback is treated as a cancel, after a 1.5 s grace period.
- `chatGptSignInSupport()` now allows `platform === 'android'`. The `VITE_CHATGPT_SIGN_IN=off` switch applies to Android as well.

## Consequences

- API keys work on Android for the first time.
- `./gradlew :app:assembleDebug`, `:app:testDebugUnitTest` and `:app:lintDebug` (0 errors) pass. Nothing has been run on a device or emulator, and nothing has been tested against a live ChatGPT account.
- Play Store distribution of ChatGPT sign-in needs OpenAI's approval, the same as the App Store ([issue 01](../../.scratch/chatgpt-login/issues/01-native-chatgpt-sign-in.md)).
