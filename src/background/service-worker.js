/*
 * BossKey FC — background service worker.
 *
 * Responsibilities:
 *   - Poll live scores on a chrome.alarms schedule and cache them.
 *   - Serve cached matches to the overlay / popup.
 *   - Proxy "boss-safe excuse" requests to the Groq API.
 *   - Relay the Alt+W toggle command to the active tab's overlay.
 */
importScripts("/src/shared/config.js");

const { STORAGE, ALARM_NAME, DEFAULT_POLL_MINUTES, DEFAULT_SCORES_ENDPOINT,
  GROQ_ENDPOINT, GROQ_MODEL, DEFAULT_SETTINGS, MSG } = self.BOSSKEY_CONFIG;

/* ------------------------------------------------------------------ */
/* Settings helpers                                                     */
/* ------------------------------------------------------------------ */
async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE.SETTINGS] || {}) };
}

/* ------------------------------------------------------------------ */
/* Score fetching                                                       */
/* ------------------------------------------------------------------ */
function normalizeMatch(raw, index) {
  // Be tolerant of differing upstream shapes; fall back gracefully.
  const home = raw.home || raw.homeTeam || {};
  const away = raw.away || raw.awayTeam || {};
  return {
    id: String(raw.id ?? raw.matchId ?? `m-${index}`),
    status: raw.status || raw.state || "SCHEDULED",
    minute: raw.minute ?? raw.time ?? null,
    home: {
      name: home.name || raw.homeName || "Home",
      code: home.code || home.shortName || "",
      score: home.score ?? raw.homeScore ?? 0
    },
    away: {
      name: away.name || raw.awayName || "Away",
      code: away.code || away.shortName || "",
      score: away.score ?? raw.awayScore ?? 0
    },
    group: raw.group || raw.stage || ""
  };
}

async function fetchMatches() {
  const settings = await getSettings();
  const endpoint = settings.scoresEndpoint || DEFAULT_SCORES_ENDPOINT;

  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.matches || data.data || [];
    const matches = list.map(normalizeMatch);
    await cacheMatches(matches, true);
    return matches;
  } catch (err) {
    console.warn("[BossKey FC] live fetch failed, using sample data:", err.message);
    const matches = self.BOSSKEY_SAMPLE_MATCHES;
    await cacheMatches(matches, false);
    return matches;
  }
}

async function cacheMatches(matches, live) {
  await chrome.storage.local.set({
    [STORAGE.MATCHES]: matches,
    [STORAGE.LAST_FETCH]: { at: Date.now(), live }
  });
}

async function getCachedMatches() {
  const stored = await chrome.storage.local.get([STORAGE.MATCHES, STORAGE.LAST_FETCH]);
  return {
    matches: stored[STORAGE.MATCHES] || [],
    meta: stored[STORAGE.LAST_FETCH] || null
  };
}

/* ------------------------------------------------------------------ */
/* Excuse generation (Groq)                                             */
/* ------------------------------------------------------------------ */
async function generateExcuse(context) {
  const settings = await getSettings();
  if (!settings.groqApiKey) {
    return { ok: false, error: "No Groq API key set. Add one in the popup settings." };
  }

  const system =
    "You generate short, professional-sounding workplace messages that a " +
    "person can send to a colleague or manager. The message must sound like " +
    "ordinary office work but secretly describe a football match event. " +
    "Never mention football, sport, scores or matches explicitly. Keep it to " +
    "one or two sentences. Return only the message text.";

  const user = `Match context: ${context || "a tense match moment"}. ` +
    "Write one believable work message that subtly encodes this moment.";

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.groqApiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.9,
        max_tokens: 120,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    const data = await res.json();
    const excuse = data.choices?.[0]?.message?.content?.trim();
    return excuse
      ? { ok: true, excuse }
      : { ok: false, error: "Empty response from Groq." };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/* Alarms                                                               */
/* ------------------------------------------------------------------ */
async function schedulePolling() {
  const settings = await getSettings();
  const minutes = Math.max(0.5, settings.pollMinutes || DEFAULT_POLL_MINUTES);
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) fetchMatches();
});

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */
chrome.runtime.onInstalled.addListener(async () => {
  await schedulePolling();
  await fetchMatches();
});

chrome.runtime.onStartup.addListener(async () => {
  await schedulePolling();
  await fetchMatches();
});

/* ------------------------------------------------------------------ */
/* Keyboard command (Alt+W)                                             */
/* ------------------------------------------------------------------ */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-overlay") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_OVERLAY }).catch(() => {});
  }
});

/* ------------------------------------------------------------------ */
/* Message router                                                       */
/* ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MSG.GET_MATCHES: {
        const cached = await getCachedMatches();
        if (!cached.matches.length) {
          const matches = await fetchMatches();
          sendResponse({ matches, meta: { at: Date.now(), live: true } });
        } else {
          sendResponse(cached);
        }
        break;
      }
      case MSG.REFRESH_MATCHES: {
        const matches = await fetchMatches();
        sendResponse({ matches });
        break;
      }
      case MSG.GENERATE_EXCUSE: {
        const result = await generateExcuse(message.context);
        sendResponse(result);
        break;
      }
      case MSG.SETTINGS_CHANGED: {
        await schedulePolling();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
