# App Privacy (nutrition labels)

Answers for App Store Connect → App Privacy, based on the current Forehead Frenzy iOS implementation.

Re-verify before every submission if native plugins or AI providers change.

## Data collection summary

**Primary stance:** Data Not Collected — for core play with bundled decks and optional on-device AI.

Cloud AI is an **optional** feature that only runs when the user pastes their own API key. In that case, prompts leave the device to Google (Gemini) or OpenAI at the user’s direction. Apple still often expects you to declare this under “Data Linked to You” / “Data Not Linked to You” carefully.

### Recommended declaration (conservative / accurate)

#### Data Not Linked to You

| Data type | Collected? | Purpose | Notes |
| --- | --- | --- | --- |
| User Content — Other User Content | Yes (optional) | App Functionality | Custom deck topics, special instructions, and generated card text when the user chooses cloud AI. Sent to the provider they selected. Not used for tracking. Not linked to identity by the app (no account). |
| Identifiers — Device ID | No | | |
| Contact Info | No | | |
| Health & Fitness | No | | |
| Financial Info | No | | |
| Location | No | | |
| Sensitive Info | No | | |
| Contacts | No | | |
| User Content — Photos/Videos | No | Cover images are generated/stored locally; not uploaded by the app except as part of the user’s own cloud AI request payload if the provider returns/uses images. |
| Browsing History | No | | |
| Search History | No | Library search stays on-device. |
| Usage Data | No | Rounds/scores stay on-device (IndexedDB / local storage). |
| Diagnostics | No | No third-party analytics observed in the project. |
| Surroundings | No | Motion used on-device for tilt scoring only; not collected or transmitted. |

#### Tracking

**No** — the app does not track users across apps/sites for advertising.

#### Product interaction / purchases

No IAP observed in the current project. If you add purchases later, update this file and App Privacy.

## Privacy policy requirement

App Store Connect requires a public Privacy Policy URL even when collection is minimal. Host `privacy-policy.md` (or an HTML export of it) and paste the URL into App Information.

## Permission strings already in the binary

| Key | String |
| --- | --- |
| `NSMotionUsageDescription` | Forehead Frenzy uses motion to mark correct answers and passes during a round. |

No camera, microphone, photo library, or tracking permission strings are required for the current feature set.
