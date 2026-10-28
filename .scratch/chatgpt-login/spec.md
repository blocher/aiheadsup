# ChatGPT sign-in as an AI provider

Status: ready-for-human

## Goal

Let players generate decks with their existing ChatGPT subscription by signing in with ChatGPT, alongside on-device AI and their own API keys.

## What OpenAI offers (researched 2026-10-28, official sources only)

Sources:
- [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart)
- [Request a client ID](https://developers.openai.com/siwc/request-client-id)
- [ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines)
- [On your website](https://developers.openai.com/siwc/website) (identity-only sign-in for commercial partners)
- [OpenID configuration](https://auth.openai.com/.well-known/openid-configuration)
- Help Center: [Using your ChatGPT plan in other apps and sites](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) (returned 403 to our fetcher, so not read)

### Two products under one name

1. **Identity sign-in** (website / ChatGPT plugin). This is a limited trial for selected commercial partners: OpenAI issues an `oaiapp_…` client ID via the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/). You get only an ID token, with no access to the user's plan.
2. **ChatGPT plan usage**. Per the docs: "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it in a paid or remotely hosted app, complete the interest form." This is the part that bills the user's plan.

### Plan-usage flow (open-source clients)

| Item | Value |
|---|---|
| Authorize | `https://auth.openai.com/api/accounts/authorize`, opened in the system browser |
| Token | `https://auth.openai.com/api/accounts/oauth/token` (form-encoded, no client secret) |
| Revoke | `https://auth.openai.com/api/accounts/oauth/revoke` (`revocation_endpoint` in discovery) |
| JWKS | `https://auth.openai.com/.well-known/jwks.json` (RS256) |
| Client registration | Dynamic: first sign-in sends `client_id=dynamic_agent_client` + `agent_name_hint`; the callback returns the issued `oaiapp_…` `client_id`, which is reused afterwards |
| Host ID | `ext_agent_host_id`: stable and opaque per install (`urn:uuid:…`, `urn:ietf:params:oauth:jwk-thumbprint:…`, or `did:key:…`) |
| Scopes | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` |
| Resource | `resource=https://api.openai.com/v1` on authorize, code exchange and refresh |
| PKCE | S256; fresh `state` and `nonce` per attempt |
| Redirect URI | **HTTP loopback on `127.0.0.1` only**, e.g. `http://127.0.0.1:1455/auth/callback`; only the port may vary; `localhost` is not allowed as a substitute |
| Plan usage granted? | Check the token response `scope` for `chatgpt.tokens.use.direct` |
| Lifetimes | Access token 1 h; refresh token 30 days, rotated on every refresh; `earliest_refresh_at` is returned |
| Refresh | `grant_type=refresh_token`, `client_id`, `refresh_token`, `resource`; omit `scope`; serialize refreshes |
| Sign-out | Revoke the refresh token (`token_type_hint=refresh_token`, `client_id`); then clear tokens locally; keep the client ID and host ID |
| Storage | Protected storage; "keep tokens out of browser storage, source control, logs, analytics"; never put tokens in URLs |
| API calls allowed | `GET /v1/models` (use entries with `visibility == "list"`) and `POST /v1/responses` with `store:false`, `stream:true`, `input` array; `instructions` allowed. Not allowed: `temperature`, `top_p`, `max_output_tokens`, `metadata`, `previous_response_id` over HTTP, image generation, file search, code interpreter, hosted MCP, audio. Do not use ChatGPT `backend-api` endpoints. |
| Errors | `subscription_sharing_user_not_eligible` (403), `…_usage_limit_exceeded` (429, show "Manage usage"), `…_usage_unavailable` (503), `…_unsupported_capability` (400), `…_route_not_supported` (403), `…_invalid_user` (401), `chatpass_v2_*` (403), `…_user_unavailable` (503); terminal refresh errors `invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused` |
| UI | Button label "Continue with ChatGPT"; show "Using ChatGPT plan" with a "Manage usage" link; on a usage limit, make "Manage usage" the primary action |

### Mobile / Capacitor

The developer docs don't cover iOS, Android or custom URL schemes; the only redirect allowed is the 127.0.0.1 loopback. OpenAI's [cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) and [devkit](https://github.com/openai/sign-in-with-chatgpt-devkit) (noncommercial license, so none of its code was copied) show a desktop app that starts a `127.0.0.1` listener and opens the system browser. The cookbook lists "open-source projects, personal projects that run locally, and selected private apps" as eligible for plan usage, says paid or remotely hosted apps should join the waitlist, and gives `https://chatgpt.com/settings/usage` as the Manage usage link.

The iOS app follows the same pattern: a native `NWListener` on 127.0.0.1, with `ASWebAuthenticationSession` as the system browser ([ADR 0002](../../docs/adr/0002-ios-chatgpt-sign-in-loopback.md)).

### CORS (checked 2026-10-28 with curl)

The token, revoke and `api.openai.com/v1` endpoints return `Access-Control-Allow-Origin: *`. The JWKS does not. The browser build therefore reads the JWKS through a same-origin Vite proxy (`/openai-auth/jwks.json`).

## What we built

See [ADR 0001](../../docs/adr/0001-chatgpt-sign-in-provider.md) and [ADR 0002](../../docs/adr/0002-ios-chatgpt-sign-in-loopback.md). In short:

- A third provider kind, `chatgpt`. On-device and API keys are unchanged.
- **iOS app:** a native 127.0.0.1 listener plus `ASWebAuthenticationSession`. Tokens are kept in the iOS Keychain. It can be turned off with `VITE_CHATGPT_SIGN_IN=off`.
- **Browser:** works when served from `http://127.0.0.1:<port>`, which is its own callback at `/auth/callback`. Tokens are kept in memory only.
- **Android and hosted web builds:** shown as "Not yet available".
- No custom URL scheme or intent filter. No other product's client ID (Codex CLI etc.) and no undocumented endpoint.

## Open work

- [01 — App Store release and Android](issues/01-native-chatgpt-sign-in.md)
- [02 — Verify the browser build against a live ChatGPT account](issues/02-live-account-verification.md)
- [03 — Test ChatGPT sign-in on a physical iPhone](issues/03-ios-device-test.md)
