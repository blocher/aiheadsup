# 01 — ChatGPT sign-in in App Store builds and on Android

Status: needs-info
Type: task

ChatGPT sign-in works in iOS builds through a native 127.0.0.1 listener ([ADR 0002](../../../docs/adr/0002-ios-chatgpt-sign-in-loopback.md)). Two things remain.

## App Store / TestFlight release

OpenAI's cookbook says paid or remotely hosted apps should join the waitlist before offering plan usage to users. Submit the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) and ask:

- Is an App Store app using the loopback + `ASWebAuthenticationSession` pattern acceptable?
- Is a dedicated client ID offered, instead of dynamic registration?

Until OpenAI approves, build store releases with `VITE_CHATGPT_SIGN_IN=off`.

## Android

Android has no `SecureAi` plugin at all, so API keys likely fail there too. It needs:

- a Kotlin/Java plugin with the same methods: a loopback listener on 127.0.0.1 (for example `ServerSocket` bound to `InetAddress.getLoopbackAddress()`), Custom Tabs for the sign-in page, and Keystore-backed storage;
- a change to `chatGptSignInSupport()` so it allows `platform === 'android'`.

## Comments
