# 03 — Test ChatGPT sign-in on a physical iPhone

Status: ready-for-human
Type: task

The Swift code in `ios/App/App/GeminiSecurePlugin.swift` (the ChatGPT section) was written without access to Xcode. Build it and check it.

```bash
yarn build && npx cap sync ios && npx cap open ios
```

1. In Xcode, build and run on your iPhone. Fix any compile errors in the `// MARK: - Sign in with ChatGPT` section.
2. Settings → Decks & AI → ChatGPT account → **Continue with ChatGPT**. A sign-in sheet should open on auth.openai.com.
3. Sign in and approve plan usage. The sheet should briefly show "Return to Forehead Frenzy" and close by itself. The card should then show **Connected** with your email.
   - If the sheet stays open on a "can't connect" page, the loopback listener didn't receive the redirect. Check the Xcode console.
   - If iOS asks for local-network permission, note it (loopback shouldn't need it).
4. Create a deck with ChatGPT selected.
5. Force-quit and relaunch. ChatGPT should still be connected (Keychain).
6. Tap **Refresh session**, then **Sign out**.
7. Try cancelling the sheet. Try declining plan usage; the card should show "Plan use off".

## Comments
