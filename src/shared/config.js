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

    // Data source. The defaults point at ESPN's free public soccer API (no key,
    // no signup) for the FIFA World Cup, which serves real live scores, match
    // minute, goal scorers and cards. The scoreboard returns the current day's
    // fixtures (live first); standings power the Stats tab. If the feed is
    // unreachable the extension falls back to bundled sample matches so the
    // overlay always renders something.
    DEFAULT_SCORES_ENDPOINT:
      "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
    // Legacy worldcup2026 teams file — only used if a custom team-id feed is set.
    DEFAULT_TEAMS_ENDPOINT:
      "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/football.teams.json",
    // Group standings (ESPN) — powers the Stats tab.
    DEFAULT_STANDINGS_ENDPOINT:
      "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings",

    // Cap how many matches the overlay cycles through (live first, then soonest).
    MAX_MATCHES: 16,

    // Groq (free tier) — used only for the Boss-Safe Excuse Generator.
    GROQ_ENDPOINT: "https://api.groq.com/openai/v1/chat/completions",
    GROQ_MODEL: "llama-3.1-8b-instant",

    // Disguise skins shown by the overlay header.
    DISGUISE_MODES: ["off", "slack", "jira", "linear", "sheets"],

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
      GET_STANDINGS: "GET_STANDINGS",
      SETTINGS_CHANGED: "SETTINGS_CHANGED",
      TOGGLE_OVERLAY: "TOGGLE_OVERLAY"
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

  // FIFA 3-letter code -> ISO 3166-1 alpha-2, used to render flag emoji.
  const FIFA_TO_ISO2 = {
    AFG: "AF", ALB: "AL", ALG: "DZ", AND: "AD", ANG: "AO", ARG: "AR", ARM: "AM",
    AUS: "AU", AUT: "AT", AZE: "AZ", BAH: "BS", BAN: "BD", BDI: "BI", BEL: "BE",
    BEN: "BJ", BER: "BM", BFA: "BF", BHR: "BH", BIH: "BA", BLR: "BY", BLZ: "BZ",
    BOL: "BO", BOT: "BW", BRA: "BR", BRU: "BN", BUL: "BG", CAN: "CA", CGO: "CG",
    CHA: "TD", CHI: "CL", CHN: "CN", CIV: "CI", CMR: "CM", COD: "CD", COL: "CO",
    COM: "KM", CPV: "CV", CRC: "CR", CRO: "HR", CTA: "CF", CUB: "CU", CUW: "CW",
    CYP: "CY", CZE: "CZ", DEN: "DK", DOM: "DO", ECU: "EC", EGY: "EG", ENG: "_ENG",
    EQG: "GQ", ERI: "ER", ESP: "ES", EST: "EE", ETH: "ET", FIJ: "FJ", FIN: "FI",
    FRA: "FR", FRO: "FO", GAB: "GA", GAM: "GM", GEO: "GE", GER: "DE", GHA: "GH",
    GNB: "GW", GRE: "GR", GUA: "GT", GUI: "GN", GUM: "GU", GUY: "GY", HAI: "HT",
    HKG: "HK", HON: "HN", HUN: "HU", IDN: "ID", INA: "ID", IND: "IN", IRL: "IE",
    IRN: "IR", IRQ: "IQ", ISL: "IS", ISR: "IL", ITA: "IT", JAM: "JM", JOR: "JO",
    JPN: "JP", KAZ: "KZ", KEN: "KE", KGZ: "KG", KOR: "KR", KSA: "SA", KUW: "KW",
    LAO: "LA", LBN: "LB", LBR: "LR", LBY: "LY", LCA: "LC", LES: "LS", LTU: "LT",
    LUX: "LU", LVA: "LV", MAD: "MG", MAR: "MA", MAS: "MY", MDA: "MD", MEX: "MX",
    MKD: "MK", MLI: "ML", MLT: "MT", MNE: "ME", MOZ: "MZ", MRI: "MU", MTN: "MR",
    MWI: "MW", MYA: "MM", NAM: "NA", NCA: "NI", NCL: "NC", NED: "NL", NEP: "NP",
    NGA: "NG", NIG: "NE", NIR: "_NIR", NOR: "NO", NZL: "NZ", OMA: "OM", PAK: "PK",
    PAN: "PA", PAR: "PY", PER: "PE", PHI: "PH", PLE: "PS", PNG: "PG", POL: "PL",
    POR: "PT", PRK: "KP", QAT: "QA", ROU: "RO", RSA: "ZA", RUS: "RU", RWA: "RW",
    SCO: "_SCO", SEN: "SN", SGP: "SG", SLE: "SL", SLV: "SV", SMR: "SM", SOL: "SB",
    SOM: "SO", SRB: "RS", SRI: "LK", SSD: "SS", STP: "ST", SUD: "SD", SUI: "CH",
    SUR: "SR", SVK: "SK", SVN: "SI", SWE: "SE", SWZ: "SZ", SYR: "SY", TAH: "PF",
    TAN: "TZ", TGA: "TO", THA: "TH", TJK: "TJ", TKM: "TM", TLS: "TL", TOG: "TG",
    TPE: "TW", TRI: "TT", TUN: "TN", TUR: "TR", UAE: "AE", UGA: "UG", UKR: "UA",
    URU: "UY", USA: "US", UZB: "UZ", VAN: "VU", VEN: "VE", VIE: "VN", WAL: "_WAL",
    YEM: "YE", ZAM: "ZM", ZIM: "ZW"
  };

  // Subdivision flags that aren't simple ISO-2 regional-indicator pairs.
  const SPECIAL_FLAGS = {
    _ENG: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    _SCO: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
    _WAL: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
    _NIR: "\u{1F1EC}\u{1F1E7}"
  };

  function flagEmoji(fifaCode) {
    const iso = FIFA_TO_ISO2[String(fifaCode || "").toUpperCase()];
    if (!iso) return "\u26BD";
    if (SPECIAL_FLAGS[iso]) return SPECIAL_FLAGS[iso];
    return iso.replace(/[A-Z]/g, (c) =>
      String.fromCodePoint(127397 + c.charCodeAt(0)));
  }

  CONFIG.flagEmoji = flagEmoji;

  root.BOSSKEY_CONFIG = CONFIG;
  root.BOSSKEY_SAMPLE_MATCHES = SAMPLE_MATCHES;
})(typeof self !== "undefined" ? self : globalThis);
