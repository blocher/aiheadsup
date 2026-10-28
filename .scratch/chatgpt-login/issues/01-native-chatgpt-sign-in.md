# 01 — Store releases of ChatGPT sign-in need OpenAI approval

Status: needs-info
Type: task

ChatGPT sign-in works in the iOS app ([ADR 0002](../../../docs/adr/0002-ios-chatgpt-sign-in-loopback.md)) and the Android app ([ADR 0003](../../../docs/adr/0003-android-secure-ai-plugin.md)) through a native 127.0.0.1 listener. OpenAI's cookbook says paid or remotely hosted apps should join the waitlist before offering plan usage to users.

Submit the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) and ask:

- Is an App Store / Play Store app using the loopback pattern acceptable?
- Is a dedicated client ID offered, instead of dynamic registration?

Until OpenAI approves, build store releases with `VITE_CHATGPT_SIGN_IN=off`.

## Comments
