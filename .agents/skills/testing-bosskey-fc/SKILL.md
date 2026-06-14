---
name: testing-bosskey-fc
description: Test BossKey-FC Chrome extension popup and overlay flows. Use when validating live scores, popup settings/API key storage, overlay HUD, disguises, or keyboard shortcuts.
---

# BossKey FC Testing

## Devin Secrets Needed

- None for scores, overlay, popup UI, shortcut, or API-key storage tests.
- `GROQ_API_KEY` is optional for testing real Groq excuse generation. For Settings/API key storage tests, use a dummy Groq-style value such as `gsk_test_...` and do not enter or record real API keys.

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

## Loading the unpacked extension

The extension lives at the repo root (`manifest.json` is at the top level). Load the whole repo folder unpacked.

Preferred UI path:

1. Open `chrome://extensions` in Chrome.
2. Enable Developer mode.
3. Click **Load unpacked** and select the repo root directory.
4. Open the BossKey FC toolbar popup and test UI flows through normal clicks.

If `chrome://extensions` shows **Developer mode** greyed/locked (the browser may be org-managed / "managed by your organization"), the UI "Load unpacked" path won't work. Workaround that has worked: relaunch Chrome adding the repo path to the existing `--load-extension` flag (keep the same `--user-data-dir` and `--remote-debugging-port`).

1. Find the running Chrome and its args: `ps aux | grep '[c]hrome'`, then `tr '\0' '\n' < /proc/<PID>/cmdline`.
2. Rebuild argv from `/proc/<PID>/cmdline` (null-delimited so args with spaces survive), append the repo dir to `--load-extension=<existing>,<repo-path>`, `kill <PID>`, wait ~3s, relaunch with the modified argv via `nohup ... &`.
3. Confirm with `chrome://extensions` showing "BossKey FC", and `curl -s http://localhost:29229/json/version`.

Note: this is a temporary test-only relaunch; it does not change any repo code.

If the Chrome file picker cannot load the directory in a Devin desktop session, a temporary local harness can be used to test popup UI logic. Keep it uncommitted and state the limitation in the report: this verifies popup JS/CSS/storage behavior, not real manifest/toolbar integration.

A harness should load the real `src/popup/popup.css`, `src/shared/config.js`, and `src/popup/popup.js`, and stub only the Chrome APIs the popup needs (`chrome.storage.sync`, `chrome.runtime.sendMessage`).

## Reaching the features
- **Overlay HUD**: auto-injects on any normal page (e.g. `https://example.com`) when `settings.enabled` is true (default). Shows top-right by default; draggable. Do NOT test on `chrome://` pages (content scripts don't inject there).
- **Popup**: click the extensions/puzzle toolbar icon, then BossKey FC (pin it for convenience). Shows the live scores list, a source line, disguise buttons, and the master toggle (top-right of popup).

## Key assertions (what distinguishes working vs broken)
- **Live scores wired (working)**: popup footer reads **"Live data · updated HH:MM"** and lists real World Cup 2026 fixtures (e.g. MEX, RSA, KOR, CZE, CAN, USA), typically `0-0 SCHEDULED` (the public dataset has no in-play data). The overlay HUD shows the same real fixtures by FIFA code.
- **Live scores broken / endpoint unreachable (fallback)**: footer reads **"Sample data"** and shows the bundled sample only — ENG 2:1 BRA (LIVE), FRA 0:0 ARG, ESP 1:1 POR (HT). If you see these team names, the live feed did not load.
- **Popup master toggle**: turning it OFF should remove `#bk-overlay` from the active page immediately; ON re-adds it. (Verify via the page DOM, not just the screenshot.)
- **Keyboard shortcuts**: `Cmd+B` on Mac / `Ctrl+B` elsewhere opens and closes the popup; `Alt+W` toggles the overlay; `Esc` hides the overlay immediately.
- **Overlay nav**: `›`/`‹` cycle through fixtures; disguise buttons (Native/Slack/Jira/Linear/Sheets) restyle the HUD.
- **Popup Settings/API key flow**: Dashboard opens by default with `Live now`, `Disguise`, and `Boss-safe excuse`; clicking **Settings** shows `Extension settings` and `API keys`; a dummy Groq key saves across reload and **Clear key** empties it.

## Data sources (public, no auth)
- Matches: `https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/football.matches.json`
- Teams: `https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/football.teams.json`
You can sanity-check the feed shape directly with `curl` before UI testing.

Record browser/desktop UI tests and annotate key assertions.
