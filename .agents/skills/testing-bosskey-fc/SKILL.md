---
name: testing-bosskey-fc
description: Test BossKey-FC Chrome extension popup and overlay flows. Use when validating popup settings, API key storage, score display, or extension UI changes.
---

# BossKey FC Testing

## Devin Secrets Needed

- `GROQ_API_KEY` is optional for testing real Groq excuse generation.
- No secret is needed for popup Settings/API key storage tests; use a dummy Groq-style value such as `gsk_test_...` and do not enter or record real API keys.

## Local Checks

Run syntax and manifest checks from the repo root:

```bash
node --check src/popup/popup.js
node --check src/background/service-worker.js
node --check src/content/overlay.js
node --check src/shared/config.js
python3 -m json.tool manifest.json >/dev/null
```

There is no package manager or build step in the current vanilla JS/MV3 setup.

## Chrome Extension Testing

1. Open `chrome://extensions` in Chrome.
2. Enable Developer mode.
3. Click **Load unpacked** and select the repo root directory.
4. Open the BossKey FC toolbar popup and test UI flows through normal clicks.

If the Chrome file picker cannot load the directory in a Devin desktop session, a temporary local harness can be used to test popup UI logic. Keep it uncommitted and state the limitation in the report: this verifies popup JS/CSS/storage behavior, not real manifest/toolbar integration.

A harness should load the real `src/popup/popup.css`, `src/shared/config.js`, and `src/popup/popup.js`, and stub only the Chrome APIs the popup needs (`chrome.storage.sync`, `chrome.runtime.sendMessage`).

## Popup Settings/API Key Flow

For Settings/API key changes, verify through the UI:

1. Dashboard opens by default with `Live now`, `Disguise`, and `Boss-safe excuse` visible, and `API keys` hidden.
2. Clicking **Settings** selects the Settings tab, shows `Extension settings` and `API keys`, and hides Dashboard cards.
3. Entering a dummy Groq key fills the password field with masked bullets.
4. Reloading and returning to Settings preserves the masked dummy key.
5. Clicking **Clear key** empties the field.
6. Reloading and returning to Settings keeps the field empty.

Record browser/desktop UI tests and annotate key assertions.