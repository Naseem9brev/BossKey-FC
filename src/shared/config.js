/*
 * Shared configuration and constants for BossKey FC.
 * Loaded as a classic script in both the content script and the service
 * worker (via importScripts), so everything is attached to globalThis.
 */
(function (root) {
  const CONFIG = {
    // Storage keys
    STORAGE: {
      SETTINGS: "bosskey_settings",
      MATCHES: "bosskey_matches",
      LAST_FETCH: "bosskey_last_fetch"
    },

    // Score polling
    ALARM_NAME: "bosskey_poll_scores",
    DEFAULT_POLL_MINUTES: 1,

    // Data source. The default is an open World Cup 2026 dataset; if it is
    // unreachable the extension falls back to bundled sample matches so the
    // overlay always renders something.
    DEFAULT_SCORES_ENDPOINT:
      "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/matches.json",

    // Groq (free tier) — used only for the Boss-Safe Excuse Generator.
    GROQ_ENDPOINT: "https://api.groq.com/openai/v1/chat/completions",
    GROQ_MODEL: "llama-3.1-8b-instant",

    // Disguise skins shown by the overlay header.
    DISGUISE_MODES: ["sheets", "slack", "jira", "off"],

    // Default user settings.
    DEFAULT_SETTINGS: {
      enabled: true,
      disguise: "off",
      pollMinutes: 1,
      favoriteTeam: "",
      groqApiKey: "",
      scoresEndpoint: ""
    },

    // Messages passed between content script, popup and service worker.
    MSG: {
      GET_MATCHES: "GET_MATCHES",
      REFRESH_MATCHES: "REFRESH_MATCHES",
      GENERATE_EXCUSE: "GENERATE_EXCUSE",
      SETTINGS_CHANGED: "SETTINGS_CHANGED",
      TOGGLE_OVERLAY: "TOGGLE_OVERLAY",
      CLOSE_POPUP: "CLOSE_POPUP"
    }
  };

  // Sample data used when the live endpoint cannot be reached.
  const SAMPLE_MATCHES = [
    {
      id: "sample-1",
      status: "LIVE",
      minute: 67,
      home: { name: "England", code: "ENG", score: 2 },
      away: { name: "Brazil", code: "BRA", score: 1 },
      group: "Group C"
    },
    {
      id: "sample-2",
      status: "LIVE",
      minute: 23,
      home: { name: "France", code: "FRA", score: 0 },
      away: { name: "Argentina", code: "ARG", score: 0 },
      group: "Group A"
    },
    {
      id: "sample-3",
      status: "HT",
      minute: 45,
      home: { name: "Spain", code: "ESP", score: 1 },
      away: { name: "Portugal", code: "POR", score: 1 },
      group: "Group D"
    }
  ];

  root.BOSSKEY_CONFIG = CONFIG;
  root.BOSSKEY_SAMPLE_MATCHES = SAMPLE_MATCHES;
})(typeof self !== "undefined" ? self : globalThis);
