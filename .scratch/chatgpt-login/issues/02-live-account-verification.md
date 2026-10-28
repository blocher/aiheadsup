# 02 — Verify ChatGPT sign-in against a live ChatGPT account

Status: ready-for-human
Type: task

The flow is covered by unit tests and a browser run with OpenAI's endpoints stubbed. It has not been run against a real ChatGPT Plus/Pro account.

1. `yarn dev --host 127.0.0.1` and open `http://127.0.0.1:5173/`. It must be `127.0.0.1`, not `localhost`.
2. Settings → Decks & AI → ChatGPT account → Continue with ChatGPT. Approve plan usage.
3. Confirm the card shows "Connected" with your email, and that "Refresh session" works.
4. Create a deck with ChatGPT selected. Check the cards arrive and the cover is the generated design.
5. Sign out. In ChatGPT Settings, confirm the app's session is gone or revoked.
6. Decline plan usage on a fresh sign-in. The card should show "Plan use off" and "Allow ChatGPT plan usage".

Watch for any `subscription_sharing_unsupported_capability` error. That would mean the Responses request body (`instructions` + `input`) needs adjusting. Also check that the `https://chatgpt.com/#settings` "Manage usage" link lands somewhere useful.

## Comments
