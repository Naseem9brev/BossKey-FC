/*
 * BossKey FC — shared HUD renderer.
 *
 * Single source of truth for the score HUD markup so the on-page overlay and
 * the popup render identical cards (native football skin + Slack/Jira/Linear/
 * Sheets disguises, Score/Stats tabs, fixture carousel, disguise switcher).
 *
 * Pure: every builder takes a `ctx` and returns an HTML string. Consumers own
 * the DOM container, state, event wiring and data fetching.
 *
 *   ctx = {
 *     settings,            // { disguise, ... }
 *     matches,             // normalized fixtures
 *     activeIndex,         // carousel position
 *     activeTab,           // "score" | "stats"
 *     standings,           // groups array or null
 *     statsLoading,        // bool
 *     statsError           // string | null
 *   }
 */
(function () {
  const cfg = window.BOSSKEY_CONFIG || {};
  const flagEmoji = cfg.flagEmoji;

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
      return `${+dd} ${MONTHS[+mm - 1]} \u00b7 ${hh}:${mi}`;
    }
    const d = new Date(localDate || "");
    if (Number.isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${d.getDate()} ${MONTHS[d.getMonth()]} \u00b7 ${hh}:${mi}`;
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

  function current(ctx) { return ctx.matches[ctx.activeIndex] || null; }

  function dots(ctx) {
    return ctx.matches
      .map((_, i) => `<i class="bk-dot${i === ctx.activeIndex ? " on" : ""}"></i>`)
      .join("");
  }

  /* ---- Native skin -------------------------------------------------- */
  function emptyBody(label) {
    return `<div class="bk-empty">${esc(label)}</div>`;
  }

  function skinOff(mt, ctx) {
    if (!mt) return shellOff(emptyBody("No matches \u00b7 \u21BB"), ctx);
    const tabs = `
      <div class="bk-tabs">
        <button class="bk-tab${ctx.activeTab === "score" ? " on" : ""}" data-bk-tab="score">Score</button>
        <button class="bk-tab${ctx.activeTab === "stats" ? " on" : ""}" data-bk-tab="stats">Stats</button>
      </div>`;
    const content = ctx.activeTab === "stats" ? statsBody(mt, ctx) : scoreBody(mt, ctx);
    return shellOff(tabs + content, ctx);
  }

  function scoreBody(mt, ctx) {
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
        <span class="bk-dots">${dots(ctx)}</span>
        <button class="bk-nav-btn" data-bk-next>\u203A</button>
      </div>`;
  }

  /* ---- Native "Stats" tab ------------------------------------------- */
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

  function findGroup(mt, ctx) {
    if (!ctx.standings) return null;
    const key = (mt.groupKey || "").toUpperCase();
    const gname = (mt.group || "").toUpperCase();
    const byKey = ctx.standings.find((g) => key && (g.key || "").toUpperCase() === key) ||
      ctx.standings.find((g) => gname && (g.group || "").toUpperCase() === gname);
    if (byKey) return byKey;
    return ctx.standings.find((g) => (g.teams || []).some((t) =>
      teamLike(t.code, mt.home.code) || teamLike(t.code, mt.away.code) ||
      teamLike(t.name, mt.home.name) || teamLike(t.name, mt.away.name))) || null;
  }

  function standingsBlock(mt, ctx) {
    const g = findGroup(mt, ctx);
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

  function statsBody(mt, ctx) {
    const scorers = scorersBlock(mt);
    const cards = cardsBlock(mt);
    let table;
    if (ctx.statsLoading && !ctx.standings) table = statsMsg("Loading standings\u2026");
    else if (ctx.statsError && !ctx.standings) table = statsMsg(ctx.statsError);
    else table = standingsBlock(mt, ctx);
    return `<div class="bk-stats">${scorers}${cards}${table}</div>`;
  }

  function shellOff(body, ctx) {
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
        ${switcherHtml(false, ctx)}
      </footer>`;
  }

  /* ---- Disguise skins ----------------------------------------------- */
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

  /* ---- Disguise switcher -------------------------------------------- */
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

  function switcherHtml(floating, ctx) {
    const cur = SKINS[ctx.settings.disguise] ? ctx.settings.disguise : "off";
    const chips = SW_ITEMS.map(([id, cls, label]) =>
      `<button class="bk-sw-chip ${cls}${id === cur ? " on" : ""}" data-bk-skin="${id}" ` +
      `title="Disguise: ${label}" aria-label="Disguise: ${label}">${SW_ICONS[id]}</button>`).join("");
    const variant = floating ? "bk-switch-float" : "bk-switch-inline";
    return `<div class="bk-switch ${variant}" data-bk-switch>${chips}</div>`;
  }

  /* ---- Public API --------------------------------------------------- */
  function render(ctx) {
    const skin = SKINS[ctx.settings.disguise] ? ctx.settings.disguise : "off";
    let html = (SKINS[skin] || skinOff)(current(ctx), ctx);
    if (skin !== "off") html += switcherHtml(true, ctx);
    return { skin, className: `bk-skin-${skin}`, html };
  }

  window.BOSSKEY_HUD = { render, SKINS, SW_ITEMS, esc, statusText, current };
})();
