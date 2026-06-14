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
  DEFAULT_TEAMS_ENDPOINT, DEFAULT_STANDINGS_ENDPOINT, MAX_MATCHES,
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
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

// Parse a kickoff into a sortable timestamp. Accepts the legacy
// "MM/DD/YYYY HH:mm" dataset format and ISO strings (ESPN).
function kickoffTs(localDate) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(localDate || "");
  if (m) {
    const [, mm, dd, yyyy, hh, mi] = m;
    return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi);
  }
  const t = Date.parse(localDate || "");
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

function deriveStatus(raw) {
  if (raw.finished === "TRUE" || raw.finished === true) return "FT";
  const te = String(raw.time_elapsed ?? "").toLowerCase();
  if (te === "" || te === "notstarted") return "SCHEDULED";
  if (te === "halftime" || te === "ht") return "HT";
  if (te === "fulltime") return "FT";
  return "LIVE";
}

function deriveMinute(raw) {
  const n = parseInt(raw.time_elapsed, 10);
  return Number.isFinite(n) ? n : null;
}

// The feed stores scorers as a string ("null" when none). Parse defensively:
// accept a JSON array, or a comma/semicolon-delimited list of names.
function parseScorers(raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "null") return [];
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) {
      return j.map((x) => {
        if (typeof x === "string") return x;
        if (x && x.name) return x.minute ? `${x.name} ${x.minute}'` : x.name;
        return String(x);
      }).filter(Boolean);
    }
  } catch (e) { /* not JSON, fall through */ }
  return s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
}

// The worldcup2026 feed references team IDs; everything else is a generic shape.
function normalizeMatch(raw, index, teamMap) {
  if (raw.home_team_id != null || raw.away_team_id != null) {
    const h = teamMap[String(raw.home_team_id)] || {};
    const a = teamMap[String(raw.away_team_id)] || {};
    return {
      id: String(raw.id ?? `m-${index}`),
      status: deriveStatus(raw),
      minute: deriveMinute(raw),
      kickoff: raw.local_date || "",
      home: { name: h.name || `Team ${raw.home_team_id}`, code: h.code || "", score: toInt(raw.home_score) },
      away: { name: a.name || `Team ${raw.away_team_id}`, code: a.code || "", score: toInt(raw.away_score) },
      group: raw.group ? `Group ${raw.group}` : (raw.type || ""),
      groupKey: raw.group || "",
      scorers: { home: parseScorers(raw.home_scorers), away: parseScorers(raw.away_scorers) }
    };
  }

  // Generic / fallback shape for custom endpoints.
  const home = raw.home || raw.homeTeam || {};
  const away = raw.away || raw.awayTeam || {};
  return {
    id: String(raw.id ?? raw.matchId ?? `m-${index}`),
    status: raw.status || raw.state || "SCHEDULED",
    minute: raw.minute ?? raw.time ?? null,
    kickoff: raw.kickoff || raw.local_date || "",
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
    group: raw.group || raw.stage || "",
    groupKey: "",
    scorers: { home: [], away: [] }
  };
}

/* ------------------------------------------------------------------ */
/* ESPN public API (default source) — live scores, scorers, cards       */
/* ------------------------------------------------------------------ */
function espnStatus(stType) {
  const state = (stType.state || "").toLowerCase();
  const desc = (stType.description || "").toLowerCase();
  if (state === "pre") return "SCHEDULED";
  if (state === "post") return "FT";
  if (desc.includes("halftime") || desc === "half time") return "HT";
  return "LIVE";
}

function espnMinute(stType) {
  const m = /(\d+)/.exec(stType.shortDetail || stType.detail || "");
  return m ? parseInt(m[1], 10) : null;
}

// Goals and cards from a competition's `details` event list, split by team.
function espnEvents(comp, homeId, awayId) {
  const goals = { home: [], away: [] };
  const cards = { home: [], away: [] };
  for (const d of comp.details || []) {
    const txt = ((d.type && d.type.text) || "").toLowerCase();
    const tid = String((d.team && d.team.id) ?? "");
    const side = tid === String(homeId) ? "home" : tid === String(awayId) ? "away" : null;
    if (!side) continue;
    const ath = (d.athletesInvolved || [])[0] || {};
    const who = ath.displayName || ath.shortName || "";
    const minute = (d.clock && d.clock.displayValue) || "";
    if (d.scoringPlay || txt.includes("goal")) {
      const own = txt.includes("own goal") ? " (OG)" : "";
      const label = (who || "Goal") + own;
      goals[side].push(minute ? `${label} ${minute}` : label);
    } else if (txt.includes("red card")) {
      cards[side].push({ who: who || "—", minute, kind: "red" });
    } else if (txt.includes("yellow card")) {
      cards[side].push({ who: who || "—", minute, kind: "yellow" });
    }
  }
  return { goals, cards };
}

function normalizeEspnEvent(ev, index, groupMap) {
  const comp = (ev.competitions || [])[0] || {};
  const stType = ((comp.status || ev.status || {}).type) || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((c) => c.homeAway === "away") || competitors[1] || {};
  const ht = home.team || {};
  const at = away.team || {};
  const code = (t) => String(t.abbreviation || t.shortDisplayName || "").toUpperCase();
  const hc = code(ht);
  const ac = code(at);
  const { goals, cards } = espnEvents(comp, ht.id, at.id);
  const group = (groupMap && (groupMap[hc] || groupMap[ac])) || "";
  return {
    id: String(ev.id ?? comp.id ?? `m-${index}`),
    status: espnStatus(stType),
    minute: espnMinute(stType),
    kickoff: ev.date || comp.date || "",
    home: { name: ht.displayName || ht.name || "Home", code: hc, score: toInt(home.score) },
    away: { name: at.displayName || at.name || "Away", code: ac, score: toInt(away.score) },
    group,
    groupKey: group.replace(/^Group\s+/i, ""),
    scorers: goals,
    cards
  };
}

// Map team code -> "Group X" from cached standings, to label fixtures.
async function buildGroupMap() {
  try {
    const groups = await fetchStandings();
    const map = {};
    for (const g of groups) {
      for (const t of g.teams) if (t.code) map[t.code.toUpperCase()] = g.group;
    }
    return map;
  } catch (err) {
    return {};
  }
}

async function fetchTeamMap() {
  try {
    const res = await fetch(DEFAULT_TEAMS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const teams = await res.json();
    const map = {};
    for (const t of teams) {
      map[String(t.id)] = {
        name: t.name_en || t.name || `Team ${t.id}`,
        code: t.fifa_code || t.code || ""
      };
    }
    return map;
  } catch (err) {
    console.warn("[BossKey FC] teams fetch failed:", err.message);
    return {};
  }
}

const STATUS_RANK = { LIVE: 0, HT: 1, SCHEDULED: 2, FT: 3 };

function prioritize(matches) {
  return matches
    .slice()
    .sort((a, b) => {
      const r = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      if (r !== 0) return r;
      return kickoffTs(a.kickoff) - kickoffTs(b.kickoff);
    })
    .slice(0, MAX_MATCHES);
}

async function fetchMatches() {
  const settings = await getSettings();
  const endpoint = settings.scoresEndpoint || DEFAULT_SCORES_ENDPOINT;

  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    let matches;
    if (data && Array.isArray(data.events)) {
      // ESPN scoreboard shape (the default source).
      const groupMap = await buildGroupMap();
      matches = prioritize(data.events.map((ev, i) => normalizeEspnEvent(ev, i, groupMap)));
    } else {
      const list = Array.isArray(data) ? data : data.matches || data.data || [];
      // Only the worldcup2026 shape needs the team-name join.
      const needsTeams = list.some((m) => m && (m.home_team_id != null || m.away_team_id != null));
      const teamMap = needsTeams ? await fetchTeamMap() : {};
      matches = prioritize(list.map((raw, i) => normalizeMatch(raw, i, teamMap)));
    }
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
/* Group standings (same open dataset)                                  */
/* ------------------------------------------------------------------ */
let standingsCache = null; // { at, groups }

// ESPN standings: { children: [ { name:"Group A", standings:{ entries:[
//   { team, stats:[{type:"points",value}, ...] } ] } } ] }
function normalizeEspnStandings(data) {
  return (data.children || []).map((g) => {
    const name = g.name || "";
    const entries = (g.standings && g.standings.entries) || [];
    const teams = entries.map((e) => {
      const t = e.team || {};
      const byType = {};
      for (const s of e.stats || []) byType[s.type] = s.value;
      const v = (k) => toInt(byType[k]);
      return {
        code: String(t.abbreviation || "").toUpperCase(),
        name: t.displayName || t.name || "",
        mp: v("gamesplayed"), w: v("wins"), d: v("ties"), l: v("losses"),
        gf: v("pointsfor"), ga: v("pointsagainst"),
        gd: v("pointdifferential"), pts: v("points")
      };
    }).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    return { group: name, key: name.replace(/^Group\s+/i, ""), teams };
  });
}

async function fetchStandings() {
  if (standingsCache && Date.now() - standingsCache.at < 60 * 1000) {
    return standingsCache.groups;
  }
  const res = await fetch(DEFAULT_STANDINGS_ENDPOINT, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  let groups;
  if (data && Array.isArray(data.children)) {
    groups = normalizeEspnStandings(data);
  } else {
    // Legacy worldcup2026 matchtables shape (team-id based).
    const teamMap = await fetchTeamMap();
    groups = (Array.isArray(data) ? data : []).map((g) => ({
      group: g.group ? `Group ${g.group}` : "",
      key: g.group || "",
      teams: (g.teams || [])
        .map((t) => {
          const info = teamMap[String(t.team_id)] || {};
          return {
            code: info.code || "",
            name: info.name || `Team ${t.team_id}`,
            mp: toInt(t.mp), w: toInt(t.w), d: toInt(t.d), l: toInt(t.l),
            gf: toInt(t.gf), ga: toInt(t.ga), gd: toInt(t.gd), pts: toInt(t.pts)
          };
        })
        .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    }));
  }
  standingsCache = { at: Date.now(), groups };
  return groups;
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
      case MSG.GET_STANDINGS: {
        try {
          const groups = await fetchStandings();
          sendResponse({ ok: true, groups });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
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
