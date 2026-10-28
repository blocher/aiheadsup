# 04 — Test the Android app on a device

Status: ready-for-human
Type: task

The Android `SecureAi` plugin compiles, passes lint and its JVM unit tests, but it hasn't run on a device.

```bash
yarn build && npx cap sync android && npx cap open android
```

## API keys (were broken on Android before)

1. Settings → Decks & AI → paste a Gemini key → Save. The notice should say "saved in Android Keystore".
2. Create a deck with Gemini, then repeat with an OpenAI key.
3. Remove a key. Relaunch the app and check the saved keys survive.

## ChatGPT sign-in

1. ChatGPT account → **Continue with ChatGPT**. A Chrome Custom Tab should open on auth.openai.com.
2. Approve plan usage. Either the app comes back by itself, or the page shows **Return to Forehead Frenzy**; tap it. The card should then show **Connected** with your email.
   - If the page shows a connection error instead, the 127.0.0.1 listener didn't get the redirect. Check `adb logcat`.
3. Create a deck with ChatGPT. Relaunch and check you are still connected (Keystore). Then try Refresh session and Sign out.
4. Open sign-in, press Back without signing in. After about 1.5 s the notice should say it was cancelled.

## Comments
