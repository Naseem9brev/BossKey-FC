/*
 * BossKey FC — content overlay.
 *
 * Draws a draggable "score HUD" on top of any page. The native skin is a
 * polished football card (flags, live pulse, fixture carousel). Each disguise
 * skin renders a *full* fake-app layout (Slack / Jira / Linear / Sheets) with
 * the live score blended into that app's UI, so a passer-by sees an office tool.
 * Panic key (Escape) hides it instantly; Alt+W toggles it.
 */
(function () {
  const { STORAGE, MSG, DEFAULT_SETTINGS, flagEmoji } = window.BOSSKEY_CONFIG;

  const POSITION_KEY = "bosskey_overlay_pos";
  let settings = { ...DEFAULT_SETTINGS };
  let matches = [];
  let activeIndex = 0;
  let root = null;
  let card = null;
  let visible = false;
  let pollTimer = null;

  // Native-HUD secondary "Stats" tab (group standings + scorers).
  let activeTab = "score";
  let standingsData = null;
  let statsLoading = false;
  let statsError = null;

  /* ---------------------------------------------------------------- */
  /* Messaging helpers                                                */
  /* ---------------------------------------------------------------- */
  function send(type, extra = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...extra }, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function loadSettings() {
    const stored = await chrome.storage.sync.get(STORAGE.SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE.SETTINGS] || {}) };
  }

  async function loadMatches() {
    const res = await send(MSG.GET_MATCHES);
    matches = (res && res.matches) || [];
    if (activeIndex >= matches.length) activeIndex = 0;
  }

  /* ---------------------------------------------------------------- */
  /* Formatting helpers                                               */
  /* ---------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function fmtKick(localDate) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(localDate || "");
    if (m) {
      const [, mm, dd, , hh, mi] = m;
      return `${+dd} ${MONTHS[+mm - 1]} · ${hh}:${mi}`;
    }
    const d = new Date(localDate || "");
    if (Number.isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${hh}:${mi}`;
  }

  function flag(code) {
    return flagEmoji ? flagEmoji(code) : "\u26BD";
  }

  function statusText(mt) {
    const s = (mt.status || "").toUpperCase();
    if (s === "LIVE") return mt.minute != null ? `${mt.minute}'` : "LIVE";
    if (s === "HT") return "HT";
    if (s === "FT") return "FT";
    return "SCHEDULED";
  }

  // App-specific status mappings.
  const JIRA_STATUS = {
    LIVE: { label: "IN PROGRESS", cls: "prog" },
    HT: { label: "IN REVIEW", cls: "review" },
    FT: { label: "DONE", cls: "done" },
    SCHEDULED: { label: "TO DO", cls: "todo" }
  };
  const LINEAR_STATUS = {
    LIVE: { label: "In Progress", cls: "started" },
    HT: { label: "In Review", cls: "review" },
    FT: { label: "Done", cls: "done" },
    SCHEDULED: { label: "Todo", cls: "todo" }
  };

  function jiraStatus(mt) { return JIRA_STATUS[(mt.status || "SCHEDULED").toUpperCase()] || JIRA_STATUS.SCHEDULED; }
  function linearStatus(mt) { return LINEAR_STATUS[(mt.status || "SCHEDULED").toUpperCase()] || LINEAR_STATUS.SCHEDULED; }

  function current() {
    return matches[activeIndex] || null;
  }

  function dots() {
    return matches
      .map((_, i) => `<i class="bk-dot${i === activeIndex ? " on" : ""}"></i>`)
      .join("");
  }

  /* ---------------------------------------------------------------- */
  /* Skin templates                                                   */
  /* ---------------------------------------------------------------- */
  function emptyBody(label) {
    return `<div class="bk-empty">${esc(label)}</div>`;
  }

  function skinOff(mt) {
    if (!mt) return shellOff(emptyBody("No matches · ↻"));
    const tabs = `
      <div class="bk-tabs">
        <button class="bk-tab${activeTab === "score" ? " on" : ""}" data-bk-tab="score">Score</button>
        <button class="bk-tab${activeTab === "stats" ? " on" : ""}" data-bk-tab="stats">Stats</button>
      </div>`;
    const content = activeTab === "stats" ? statsBody(mt) : scoreBody(mt);
    return shellOff(tabs + content);
  }

  function scoreBody(mt) {
    const live = (mt.status || "").toUpperCase() === "LIVE";
    const st = statusText(mt);
    const stCls = (mt.status || "").toLowerCase();
    return `
      <div class="bk-stage">
        <div class="bk-side">
          <span class="bk-flag">${flag(mt.home.code)}</span>
          <span class="bk-code">${esc(mt.home.code || mt.home.name)}</span>
        </div>
        <div class="bk-center">
          <div class="bk-score"><b>${esc(mt.home.score)}</b><i>:</i><b>${esc(mt.away.score)}</b></div>
          <div class="bk-status bk-status-${stCls}">${live ? '<span class="bk-pulse"></span>' : ""}${esc(st)}</div>
        </div>
        <div class="bk-side">
          <span class="bk-flag">${flag(mt.away.code)}</span>
          <span class="bk-code">${esc(mt.away.code || mt.away.name)}</span>
        </div>
      </div>
      <div class="bk-subrow">
        <span class="bk-group">${esc(mt.group || "")}</span>
        <span class="bk-kick">${esc(fmtKick(mt.kickoff))}</span>
      </div>
      <div class="bk-nav">
        <button class="bk-nav-btn" data-bk-prev>\u2039</button>
        <span class="bk-dots">${dots()}</span>
        <button class="bk-nav-btn" data-bk-next>\u203A</button>
      </div>`;
  }

  /* ---- Native "Stats" tab: scorers + group standings ------------- */
  function statsMsg(text) {
    return `<div class="bk-stats-msg">${esc(text)}</div>`;
  }

  function teamLike(a, b) {
    if (!a || !b) return false;
    const x = String(a).toLowerCase();
    const y = String(b).toLowerCase();
    return x === y || x.includes(y) || y.includes(x);
  }

  function scorersBlock(mt) {
    const h = (mt.scorers && mt.scorers.home) || [];
    const a = (mt.scorers && mt.scorers.away) || [];
    if (!h.length && !a.length) return "";
    const li = (arr, code) => arr.map((s) =>
      `<div class="bk-scorer"><span class="bk-ev-ic">\u26BD</span>` +
      `<span class="bk-ev-who">${esc(s)}</span>` +
      `<span class="bk-ev-tm">${esc(code)}</span></div>`).join("");
    return `<div class="bk-ev-head">Scorers</div>` +
      `<div class="bk-ev-list">${li(h, mt.home.code || mt.home.name)}${li(a, mt.away.code || mt.away.name)}</div>`;
  }

  function cardsBlock(mt) {
    const h = (mt.cards && mt.cards.home) || [];
    const a = (mt.cards && mt.cards.away) || [];
    if (!h.length && !a.length) return "";
    const ic = (kind) => kind === "red" ? "bk-card-red" : "bk-card-yel";
    const li = (arr, code) => arr.map((c) =>
      `<div class="bk-scorer"><span class="bk-ev-ic ${ic(c.kind)}"></span>` +
      `<span class="bk-ev-who">${esc(c.who)}${c.minute ? " " + esc(c.minute) : ""}</span>` +
      `<span class="bk-ev-tm">${esc(code)}</span></div>`).join("");
    return `<div class="bk-ev-head">Cards</div>` +
      `<div class="bk-ev-list">${li(h, mt.home.code || mt.home.name)}${li(a, mt.away.code || mt.away.name)}</div>`;
  }

  function findGroup(mt) {
    if (!standingsData) return null;
    const key = (mt.groupKey || "").toUpperCase();
    const gname = (mt.group || "").toUpperCase();
    const byKey = standingsData.find((g) => key && (g.key || "").toUpperCase() === key) ||
      standingsData.find((g) => gname && (g.group || "").toUpperCase() === gname);
    if (byKey) return byKey;
    // Fallback: find the group containing either of the fixture's teams.
    return standingsData.find((g) => (g.teams || []).some((t) =>
      teamLike(t.code, mt.home.code) || teamLike(t.code, mt.away.code) ||
      teamLike(t.name, mt.home.name) || teamLike(t.name, mt.away.name))) || null;
  }

  function standingsBlock(mt) {
    const g = findGroup(mt);
    if (!g) return statsMsg("Standings show for group-stage fixtures.");
    const rows = g.teams.map((t, i) => {
      const here = teamLike(t.code, mt.home.code) || teamLike(t.code, mt.away.code) ||
        teamLike(t.name, mt.home.name) || teamLike(t.name, mt.away.name);
      const gd = `${t.gd > 0 ? "+" : ""}${t.gd}`;
      return `<tr class="${here ? "bk-tr-on" : ""}">` +
        `<td class="bk-tpos">${i + 1}</td>` +
        `<td class="bk-tteam">${flag(t.code)} ${esc(t.code || t.name)}</td>` +
        `<td>${t.mp}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>` +
        `<td>${esc(gd)}</td><td class="bk-tpts">${t.pts}</td></tr>`;
    }).join("");
    return `<div class="bk-ev-head">${esc(g.group || "Group")}</div>` +
      `<table class="bk-table"><thead><tr>` +
      `<th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>` +
      `</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function statsBody(mt) {
    const scorers = scorersBlock(mt);
    const cards = cardsBlock(mt);
    let table;
    if (statsLoading && !standingsData) table = statsMsg("Loading standings\u2026");
    else if (statsError && !standingsData) table = statsMsg(statsError);
    else table = standingsBlock(mt);
    return `<div class="bk-stats">${scorers}${cards}${table}</div>`;
  }

  function shellOff(body) {
    return `
      <div class="bk-pitch"></div>
      <header class="bk-head" data-bk-drag>
        <span class="bk-comp"><span class="bk-trophy">\u{1F3C6}</span> World Cup 2026</span>
        <div class="bk-head-actions">
          <button class="bk-icon-btn" data-bk-refresh title="Refresh">\u21BB</button>
          <button class="bk-icon-btn bk-panic" data-bk-panic title="Hide (Esc)">\u2715</button>
        </div>
      </header>
      <div class="bk-body">${body}</div>
      <footer class="bk-foot">
        <button class="bk-excuse-btn" data-bk-excuse>\u{1F4AC} Boss-safe excuse</button>
        <div class="bk-excuse-out" hidden></div>
        ${switcherHtml(false)}
      </footer>`;
  }

  function scoreLine(mt) {
    return `${flag(mt.home.code)} ${esc(mt.home.name)} <b>${esc(mt.home.score)}\u2013${esc(mt.away.score)}</b> ${esc(mt.away.name)} ${flag(mt.away.code)}`;
  }

  function skinSlack(mt) {
    const live = (mt && (mt.status || "").toUpperCase() === "LIVE");
    const status = mt ? statusText(mt) : "";
    return `
      <header class="sk-slk-head" data-bk-drag>
        <span class="sk-slk-ch"><span class="sk-hash">#</span> world-cup</span>
        <button class="sk-x" data-bk-panic title="Hide (Esc)">\u2715</button>
      </header>
      <div class="sk-slk-list" data-bk-next title="Next match">
        <div class="sk-avatar">\u26BD</div>
        <div class="sk-msg">
          <div class="sk-msg-top"><b>matchday</b><span class="sk-app">APP</span><span class="sk-time">2:14 PM</span></div>
          <div class="sk-msg-text">${mt ? scoreLine(mt) : "No fixtures right now"}${mt ? ` <span class="sk-live ${live ? "on" : ""}">${esc(status)}</span>` : ""}</div>
          <div class="sk-reacts"><span class="sk-react">\u{1F525} 4</span><span class="sk-react">\u26BD 7</span><span class="sk-react sk-addr">\u{1F642}\u002B</span></div>
        </div>
      </div>
      <div class="sk-slk-compose">
        <span class="sk-plus">\u002B</span>
        <span class="sk-input">Message #world-cup</span>
        <span class="sk-send" data-bk-excuse title="Boss-safe excuse">\u27A4</span>
      </div>
      <div class="bk-excuse-out sk-slk-note" hidden></div>`;
  }

  function skinJira(mt) {
    const js = mt ? jiraStatus(mt) : JIRA_STATUS.SCHEDULED;
    const summary = mt
      ? `${flag(mt.home.code)} ${esc(mt.home.code)} ${esc(mt.home.score)}\u2013${esc(mt.away.score)} ${esc(mt.away.code)} ${flag(mt.away.code)} \u00b7 ${esc(statusText(mt))}`
      : "Awaiting fixtures";
    const grp = mt && mt.group ? esc(mt.group) : "Backlog";
    return `
      <header class="sk-jira-head" data-bk-drag>
        <span class="sk-jira-proj"><span class="sk-jira-mark">\u25A3</span> BOSS board</span>
        <button class="sk-x" data-bk-panic title="Hide (Esc)">\u2715</button>
      </header>
      <div class="sk-jira-rows">
        <div class="sk-jira-row" data-bk-next title="Next match">
          <span class="sk-jtype sk-story">\u2714</span>
          <span class="sk-jkey">BOSS-2026</span>
          <span class="sk-jsum">${summary}</span>
          <span class="sk-loz sk-${js.cls}">${js.label}</span>
          <span class="sk-jav">M</span>
        </div>
        <div class="sk-jira-row sk-dim">
          <span class="sk-jtype sk-task">\u25A4</span>
          <span class="sk-jkey">BOSS-2027</span>
          <span class="sk-jsum">${grp} standings review</span>
          <span class="sk-loz sk-todo">TO DO</span>
          <span class="sk-jav sk-jav2">A</span>
        </div>
      </div>`;
  }

  function skinLinear(mt) {
    const ls = mt ? linearStatus(mt) : LINEAR_STATUS.SCHEDULED;
    const name = mt
      ? `${flag(mt.home.code)} ${esc(mt.home.code)} ${esc(mt.home.score)}\u2013${esc(mt.away.score)} ${esc(mt.away.code)} ${flag(mt.away.code)} \u00b7 ${esc(statusText(mt))}`
      : "Awaiting fixtures";
    return `
      <header class="sk-lin-head" data-bk-drag>
        <span class="sk-lin-title"><span class="sk-lin-mark">\u25C9</span> Active Issues</span>
        <button class="sk-x" data-bk-panic title="Hide (Esc)">\u2715</button>
      </header>
      <div class="sk-lin-rows">
        <div class="sk-lin-row" data-bk-next title="Next match">
          <span class="sk-lprio"><i></i><i></i><i></i></span>
          <span class="sk-ldot sk-${ls.cls}"></span>
          <span class="sk-lid">FC-26</span>
          <span class="sk-lname">${name}</span>
          <span class="sk-lstat">${ls.label}</span>
          <span class="sk-lav">M</span>
        </div>
        <div class="sk-lin-row sk-dim">
          <span class="sk-lprio sk-lprio2"><i></i><i></i><i></i></span>
          <span class="sk-ldot sk-todo"></span>
          <span class="sk-lid">FC-27</span>
          <span class="sk-lname">Review group stage table</span>
          <span class="sk-lstat">Todo</span>
          <span class="sk-lav sk-lav2">A</span>
        </div>
      </div>`;
  }

  function skinSheets(mt) {
    const h = mt ? mt.home : { code: "", score: "" };
    const a = mt ? mt.away : { code: "", score: "" };
    const s = mt ? (mt.status || "").toUpperCase() : "";
    const min = !mt ? ""
      : s === "LIVE" ? (mt.minute != null ? `${mt.minute}'` : "LIVE")
      : s === "HT" ? "HT"
      : s === "FT" ? "FT"
      : "\u2014";
    const grp = mt && mt.group ? esc(mt.group.replace(/^Group\s*/i, "")) : "";
    return `
      <header class="sk-sh-head" data-bk-drag>
        <span class="sk-sh-doc"><span class="sk-sh-mark">\u2637</span> Q3 Forecast</span>
        <button class="sk-x" data-bk-panic title="Hide (Esc)">\u2715</button>
      </header>
      <div class="sk-sh-toolbar"><span>\u21A9</span><span>\u21AA</span><span class="sk-sh-sep"></span><span>B</span><span><i>I</i></span><span>\u2630</span></div>
      <div class="sk-grid">
        <div class="sk-corner"></div>
        <div class="sk-colh">A</div><div class="sk-colh">B</div><div class="sk-colh">C</div>
        <div class="sk-rowh">1</div>
        <div class="sk-cell sk-th">Team</div><div class="sk-cell sk-th">Pts</div><div class="sk-cell sk-th">Min</div>
        <div class="sk-rowh">2</div>
        <div class="sk-cell sk-link" data-bk-next title="Next match">${esc(h.code)}</div><div class="sk-cell sk-num">${esc(h.score)}</div><div class="sk-cell sk-min">${esc(min)}</div>
        <div class="sk-rowh">3</div>
        <div class="sk-cell">${esc(a.code)}</div><div class="sk-cell sk-num">${esc(a.score)}</div><div class="sk-cell sk-grp">${grp}</div>
      </div>`;
  }

  const SKINS = {
    off: skinOff,
    slack: skinSlack,
    jira: skinJira,
    linear: skinLinear,
    sheets: skinSheets
  };

  /* ---- Disguise switcher (hover-reveal app chips on every skin) --- */
  const SW_ICONS = {
    off: '<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="1.6"/><path fill="#fff" d="M12 7.4l2.7 1.9-1 3.2h-3.4l-1-3.2z"/></svg>',
    slack: '<svg viewBox="0 0 122.8 122.8" width="14" height="14"><path fill="#fff" d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9zM32.3 77.6a12.9 12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 0 1-25.8 0z"/><path fill="#fff" d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9zM45.2 32.3a12.9 12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8z"/><path fill="#fff" d="M97 45.2a12.9 12.9 0 1 1 12.9 12.9H97zM90.5 45.2a12.9 12.9 0 0 1-25.8 0V12.9a12.9 12.9 0 0 1 25.8 0z"/><path fill="#fff" d="M77.6 97a12.9 12.9 0 1 1-12.9 12.9V97zM77.6 90.5a12.9 12.9 0 0 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8z"/></svg>',
    jira: '<svg viewBox="0 0 32 32" width="14" height="14"><path fill="#fff" d="M28.5 15.2 16.4 3.1 15.2 1.9l-9.1 9.1-4 4a1.1 1.1 0 0 0 0 1.6l8.1 8.1 5 5 1.2 1.2 9.1-9.1 2.4-2.4a1.1 1.1 0 0 0 0-1.6zM15.2 20.2 11 16l4.2-4.2L19.4 16z"/></svg>',
    linear: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M3 13 13 3"/><path d="M6.5 18.5 18.5 6.5"/><path d="M11 21 21 11"/></svg>',
    sheets: '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="4.5" y="3" width="15" height="18" rx="2" fill="none" stroke="#fff" stroke-width="1.6"/><path stroke="#fff" stroke-width="1.4" d="M4.5 10h15M4.5 15h15M12 6v15"/></svg>'
  };
  const SW_ITEMS = [
    ["off", "bk-sw-off", "Scoreboard"],
    ["slack", "bk-sw-slack", "Slack"],
    ["jira", "bk-sw-jira", "Jira"],
    ["linear", "bk-sw-linear", "Linear"],
    ["sheets", "bk-sw-sheets", "Sheets"]
  ];

  function switcherHtml(floating) {
    const cur = SKINS[settings.disguise] ? settings.disguise : "off";
    const chips = SW_ITEMS.map(([id, cls, label]) =>
      `<button class="bk-sw-chip ${cls}${id === cur ? " on" : ""}" data-bk-skin="${id}" ` +
      `title="Disguise: ${label}" aria-label="Disguise: ${label}">${SW_ICONS[id]}</button>`).join("");
    const variant = floating ? "bk-switch-float" : "bk-switch-inline";
    return `<div class="bk-switch ${variant}" data-bk-switch>${chips}</div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */
  function buildShell() {
    root = document.createElement("div");
    root.id = "bk-overlay";
    root.setAttribute("role", "complementary");
    card = document.createElement("div");
    card.className = "bk-card";
    root.appendChild(card);
    document.documentElement.appendChild(root);
    restorePosition();
  }

  function render() {
    if (!root) buildShell();
    const skin = SKINS[settings.disguise] ? settings.disguise : "off";
    root.className = `bk-skin-${skin}`;
    card.innerHTML = (SKINS[skin] || skinOff)(current());
    if (skin !== "off") card.insertAdjacentHTML("beforeend", switcherHtml(true));
    wireEvents();
  }

  /* ---------------------------------------------------------------- */
  /* Visibility                                                       */
  /* ---------------------------------------------------------------- */
  function show() {
    if (!root) buildShell();
    visible = true;
    root.style.display = "block";
    render();
    startPolling();
  }

  function hide() {
    visible = false;
    if (root) root.style.display = "none";
    stopPolling();
  }

  function toggle() {
    visible ? hide() : show();
  }

  function panic() {
    hide();
  }

  function startPolling() {
    stopPolling();
    const ms = Math.max(30, (settings.pollMinutes || 1) * 60) * 1000;
    pollTimer = setInterval(async () => {
      await loadMatches();
      if (visible) render();
    }, ms);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ---------------------------------------------------------------- */
  /* Dragging + persistence                                           */
  /* ---------------------------------------------------------------- */
  function restorePosition() {
    chrome.storage.local.get(POSITION_KEY).then((res) => {
      const pos = res[POSITION_KEY];
      if (pos) {
        root.style.left = pos.left;
        root.style.top = pos.top;
        root.style.right = "auto";
        root.style.bottom = "auto";
      }
    });
  }

  function enableDrag(handle) {
    if (!handle) return;
    let startX, startY, originLeft, originTop, dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-bk-panic],[data-bk-refresh]")) return;
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      const rect = root.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const left = Math.max(0, originLeft + (e.clientX - startX));
      const top = Math.max(0, originTop + (e.clientY - startY));
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      chrome.storage.local.set({
        [POSITION_KEY]: { left: root.style.left, top: root.style.top }
      });
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                           */
  /* ---------------------------------------------------------------- */
  function wireEvents() {
    enableDrag(card.querySelector("[data-bk-drag]"));

    card.querySelectorAll("[data-bk-panic]").forEach((el) =>
      el.addEventListener("click", (e) => { e.stopPropagation(); panic(); }));

    const refresh = card.querySelector("[data-bk-refresh]");
    if (refresh) refresh.addEventListener("click", async (e) => {
      e.stopPropagation();
      const res = await send(MSG.REFRESH_MATCHES);
      matches = (res && res.matches) || matches;
      if (activeIndex >= matches.length) activeIndex = 0;
      render();
    });

    card.querySelectorAll("[data-bk-next]").forEach((el) =>
      el.addEventListener("click", () => {
        if (!matches.length) return;
        activeIndex = (activeIndex + 1) % matches.length;
        render();
      }));

    card.querySelectorAll("[data-bk-prev]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!matches.length) return;
        activeIndex = (activeIndex - 1 + matches.length) % matches.length;
        render();
      }));

    card.querySelectorAll("[data-bk-tab]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const tab = el.dataset.bkTab;
        if (tab === activeTab) return;
        activeTab = tab;
        render();
        if (tab === "stats") loadStandings();
      }));

    const excuse = card.querySelector("[data-bk-excuse]");
    if (excuse) excuse.addEventListener("click", (e) => { e.stopPropagation(); onExcuse(); });

    card.querySelectorAll("[data-bk-skin]").forEach((el) =>
      el.addEventListener("click", (e) => { e.stopPropagation(); setDisguise(el.dataset.bkSkin); }));
  }

  async function setDisguise(skin) {
    if (!skin || !SKINS[skin] || skin === settings.disguise) return;
    settings.disguise = skin;
    render();
    try {
      await chrome.storage.sync.set({ [STORAGE.SETTINGS]: settings });
    } catch (_) { /* storage may be unavailable; UI already updated */ }
  }

  async function loadStandings() {
    if (standingsData) {
      if (activeTab === "stats" && visible) render();
      return;
    }
    statsLoading = true;
    statsError = null;
    if (activeTab === "stats" && visible) render();
    const res = await send(MSG.GET_STANDINGS);
    statsLoading = false;
    if (!res || !res.ok) statsError = (res && res.error) || "Could not load standings.";
    else { standingsData = res.groups || []; statsError = null; }
    if (activeTab === "stats" && visible) render();
  }

  async function onExcuse() {
    const out = card.querySelector(".bk-excuse-out");
    if (out) {
      out.hidden = false;
      out.textContent = "Thinking\u2026";
    }
    const m = current();
    const context = m
      ? `${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}, ${m.minute || ""}'`
      : "a tense moment";
    const res = await send(MSG.GENERATE_EXCUSE, { context });
    if (out) out.textContent = res && res.ok ? res.excuse : (res?.error || "Could not generate.");
  }

  // Panic key — Escape hides the overlay instantly.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && visible) panic();
    },
    true
  );

  // Toggle command relayed from the service worker.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.TOGGLE_OVERLAY) toggle();
  });

  // React to settings changes from the popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE.SETTINGS]) {
      const wasEnabled = settings.enabled;
      settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE.SETTINGS].newValue };
      if (wasEnabled !== settings.enabled) {
        settings.enabled ? show() : hide();
        return;
      }
      if (visible) render();
    }
  });

  /* ---------------------------------------------------------------- */
  /* Init                                                             */
  /* ---------------------------------------------------------------- */
  (async function init() {
    await loadSettings();
    await loadMatches();
    if (settings.enabled) show();
  })();
})();
