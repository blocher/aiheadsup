# iOS App Store asset pack — Forehead Frenzy

Everything you need to fill App Store Connect for `com.dailyoffice2019.foreheadfrenzy` (v1.9).

## Quick upload map

| App Store Connect field | File / source |
| --- | --- |
| App icon (1024×1024, no alpha) | [`icon/AppIcon-1024.png`](icon/AppIcon-1024.png) |
| Name / subtitle / description / keywords | [`listing.md`](listing.md) |
| Screenshots (iPhone **6.5″** — use this set) | [`screenshots/iphone-6.5/`](screenshots/iphone-6.5/) — **1242×2688** / **2688×1242** |
| Screenshots (iPhone 6.9″) | [`screenshots/iphone-6.9/`](screenshots/iphone-6.9/) — 1290×2796 (optional alternate slot) |
| Screenshots (iPad 13″) | [`screenshots/ipad-13/`](screenshots/ipad-13/) — **2048×2732** portrait / **2732×2048** landscape (`04-gameplay-landscape.png`) |
| Privacy Policy URL | https://foreheadfrenzy.benlocher.com/privacy-policy.html |
| App Privacy answers | [`privacy-nutrition-labels.md`](privacy-nutrition-labels.md) |
| Age rating answers | [`age-rating.md`](age-rating.md) |
| Review notes | bottom of [`listing.md`](listing.md) |
| Marketing art (optional) | [`marketing/`](marketing/) |

## Recommended iPhone screenshot order

Upload from **`screenshots/iphone-6.5/`** (matches App Store Connect’s 6.5″ well). Use **either** the clean set **or** the framed set:

1. `01-welcome.png` / `framed-01-welcome.png` — how the game works  
2. `02-library.png` / `framed-02-library.png` — deck library  
3. `03-pack-detail.png` / `framed-03-start-round.png` — start a round  
4. `04-gameplay-landscape.png` **or** `framed-04-gameplay.png` — live play  
5. `05-ai-create.png` / `framed-05-ai.png` — AI packs  
6. `06-make-your-own.png` / `framed-06-custom.png` — custom decks tip  

Accepted sizes for that well: **1242×2688**, **2688×1242**, **1284×2778**, or **2778×1284**.

## Still needed from you (cannot invent)

1. **App Review contact** phone + email.  
2. **Export compliance** — if you only use HTTPS / standard encryption, answer No to non-exempt encryption (or add `ITSAppUsesNonExemptEncryption = false` in Info.plist).  
3. **Content rights** confirmation in Connect.  
4. Optional: replace `05-ai-create.png` with a native-device capture of the full create form once a cloud key or on-device AI is available on a phone.

## Regenerate screenshots

With the preview server running (`yarn build && yarn preview --host 127.0.0.1 --port 4173`):

```bash
yarn store:screenshots
yarn store:compose
```

- `store:screenshots` — Puppeteer + system Chrome → `screenshots/raw/`  
- `store:compose` — ImageMagick → `iphone-6.9/`, `iphone-6.5/`, `ipad-13/`

## Notes

- Icon is flattened RGB PNG without alpha (App Store rejects transparency).  
- Screenshots were captured from the web build at phone viewport; gameplay and library match the iOS UI. The AI create shot’s body copy was adjusted to describe the iPhone product (on-device / Keychain) rather than the browser-only empty state.  
- No account, ads, or analytics in the current app — keep App Privacy declarations in sync if that changes.
