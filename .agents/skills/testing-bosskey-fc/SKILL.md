---
name: testing-bosskey-fc
description: Load and runtime-test the BossKey FC MV3 Chrome extension (popup live scores + on-page overlay). Use when verifying scores wiring, the overlay HUD, disguises, or the popup master toggle.
---

# Testing BossKey FC (Chrome MV3 extension)

## Loading the unpacked extension
The extension lives at the repo root (`manifest.json` is at the top level). Load the whole repo folder unpacked.

If `chrome://extensions` shows **Developer mode** greyed/locked (the browser may be org-managed / "managed by your organization"), the UI "Load unpacked" path won't work. Workaround that has worked: relaunch Chrome adding the repo path to the existing `--load-extension` flag (keep the same `--user-data-dir` and `--remote-debugging-port`).

1. Find the running Chrome and its args: `ps aux | grep '[c]hrome'`, then `tr '\0' '\n' < /proc/<PID>/cmdline`.
2. Rebuild argv from `/proc/<PID>/cmdline` (null-delimited so args with spaces survive), append the repo dir to `--load-extension=<existing>,<repo-path>`, `kill <PID>`, wait ~3s, relaunch with the modified argv via `nohup ... &`.
3. Confirm with `chrome://extensions` showing "BossKey FC", and `curl -s http://localhost:29229/json/version`.

Note: this is a temporary test-only relaunch; it does not change any repo code.

## Reaching the features
- **Overlay HUD**: auto-injects on any normal page (e.g. `https://example.com`) when `settings.enabled` is true (default). Shows top-right by default; draggable. Do NOT test on `chrome://` pages (content scripts don't inject there).
- **Popup**: click the extensions/puzzle toolbar icon, then BossKey FC (pin it for convenience). Shows the live scores list, a source line, disguise buttons, and the master toggle (top-right of popup).

## Key assertions (what distinguishes working vs broken)
- **Live scores wired (working)**: popup footer reads **"Live data · updated HH:MM"** and lists real World Cup 2026 fixtures (e.g. MEX, RSA, KOR, CZE, CAN, USA), typically `0-0 SCHEDULED` (the public dataset has no in-play data). The overlay HUD shows the same real fixtures by FIFA code.
- **Live scores broken / endpoint unreachable (fallback)**: footer reads **"Sample data"** and shows the bundled sample only — ENG 2:1 BRA (LIVE), FRA 0:0 ARG, ESP 1:1 POR (HT). If you see these team names, the live feed did not load.
- **Popup master toggle**: turning it OFF should remove `#bk-overlay` from the active page immediately; ON re-adds it. (Verify via the page DOM, not just the screenshot.)
- **Overlay nav**: `›`/`‹` cycle through fixtures; `Esc` (panic) and `Alt+W` hide/toggle the overlay; disguise buttons (Sheets/Slack/Jira) restyle the HUD.

## Data sources (public, no auth)
- Matches: `https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/football.matches.json`
- Teams: `https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/football.teams.json`
You can sanity-check the feed shape directly with `curl` before UI testing.

## Quick static checks before UI testing
`node --check` each JS file under `src/`, and validate `manifest.json` is valid JSON. Confirm `icons/` has icon16/48/128.png.

## Devin Secrets Needed
- None for scores/overlay/toggle testing (public dataset, no login).
- The boss-safe excuse generator needs a user-supplied **Groq API key** (pasted in the popup) — not stored as a Devin secret. Skip/mark untested unless the user provides one.
