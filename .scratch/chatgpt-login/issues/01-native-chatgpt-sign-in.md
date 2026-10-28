# 01 — Enable ChatGPT sign-in in the iOS/Android apps

Status: needs-info
Type: task

The native apps show ChatGPT as "Not yet available". To enable it we need, from OpenAI:

1. Approval for plan usage in a distributed (App Store / Play Store) app, via the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/).
2. An officially supported mobile redirect, either a custom URL scheme (`com.benjaminlocher.foreheadfrenzy://auth/callback`) or a universal/app link. Today only `http://127.0.0.1` loopback is documented.

Once both exist:

- Return the native redirect URI from `chatGptSignInSupport()` in `src/lib/chatgpt-auth.js`.
- Add `CFBundleURLTypes` to `ios/App/App/Info.plist` and an intent filter to `android/app/src/main/AndroidManifest.xml`. Handle the callback with `@capacitor/app` `appUrlOpen` and open the authorize URL with `@capacitor/browser` or ASWebAuthenticationSession.
- Store tokens in iOS Keychain / Android Keystore (extend the `SecureAi` plugin). Android has no `SecureAi` implementation yet.
- Test on a physical iPhone and Android phone.

## Comments
