/*
 * BossKey FC — content overlay.
 *
 * Draws a small draggable "score HUD" on top of any page. Designed to be
 * dismissed instantly with the panic key (Escape) and toggled with Alt+W.
 * Optional disguise skins make the widget read like an office tool.
 */
(function () {
  const { STORAGE, MSG, DEFAULT_SETTINGS } = window.BOSSKEY_CONFIG;

  const POSITION_KEY = "bosskey_overlay_pos";
  let settings = { ...DEFAULT_SETTINGS };
  let matches = [];
  let activeIndex = 0;
  let root = null;
  let visible = false;
  let pollTimer = null;

  const DISGUISE = {
    off: { title: "BossKey FC", glyph: "\u26BD", className: "bk-skin-off" },
    sheets: { title: "Sheet1 \u2014 Budget", glyph: "\u2630", className: "bk-skin-sheets" },
    slack: { title: "# team-standup", glyph: "\u0040", className: "bk-skin-slack" },
    jira: { title: "BOSS-2026 \u2014 Board", glyph: "\u25A4", className: "bk-skin-jira" }
  };

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
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */
  function buildShell() {
    root = document.createElement("div");
    root.id = "bk-overlay";
    root.setAttribute("role", "complementary");
    root.innerHTML = `
      <div class="bk-card">
        <header class="bk-head" data-bk-drag>
          <span class="bk-glyph"></span>
          <span class="bk-title"></span>
          <div class="bk-head-actions">
            <button class="bk-icon-btn" data-bk-refresh title="Refresh">\u21BB</button>
            <button class="bk-icon-btn bk-panic" data-bk-panic title="Panic (Esc)">\u2715</button>
          </div>
        </header>
        <div class="bk-body">
          <div class="bk-score"></div>
          <div class="bk-meta"></div>
          <div class="bk-nav">
            <button class="bk-nav-btn" data-bk-prev>\u2039</button>
            <span class="bk-dots"></span>
            <button class="bk-nav-btn" data-bk-next>\u203A</button>
          </div>
        </div>
        <footer class="bk-foot">
          <button class="bk-excuse-btn" data-bk-excuse>Boss-safe excuse</button>
          <div class="bk-excuse-out" hidden></div>
        </footer>
      </div>`;
    document.documentElement.appendChild(root);
    wireEvents();
    restorePosition();
  }

  function renderMatch() {
    if (!root) return;
    const skin = DISGUISE[settings.disguise] || DISGUISE.off;
    root.className = skin.className;
    root.querySelector(".bk-glyph").textContent = skin.glyph;
    root.querySelector(".bk-title").textContent = skin.title;

    const dots = root.querySelector(".bk-dots");
    dots.innerHTML = matches
      .map((_, i) => `<i class="bk-dot${i === activeIndex ? " on" : ""}"></i>`)
      .join("");

    const scoreEl = root.querySelector(".bk-score");
    const metaEl = root.querySelector(".bk-meta");

    if (!matches.length) {
      scoreEl.textContent = "No matches";
      metaEl.textContent = "Try refresh \u21BB";
      return;
    }

    const m = matches[activeIndex];
    scoreEl.innerHTML = `
      <span class="bk-team">${esc(m.home.code || m.home.name)}</span>
      <span class="bk-num">${m.home.score}</span>
      <span class="bk-sep">:</span>
      <span class="bk-num">${m.away.score}</span>
      <span class="bk-team">${esc(m.away.code || m.away.name)}</span>`;

    const minute = m.minute != null ? `${m.minute}'` : "";
    metaEl.innerHTML = `
      <span class="bk-status bk-status-${(m.status || "").toLowerCase()}">${esc(m.status)}</span>
      <span class="bk-minute">${minute}</span>
      <span class="bk-group">${esc(m.group || "")}</span>`;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ---------------------------------------------------------------- */
  /* Visibility                                                       */
  /* ---------------------------------------------------------------- */
  function show() {
    if (!root) buildShell();
    visible = true;
    root.style.display = "block";
    renderMatch();
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
      renderMatch();
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
    let startX, startY, originLeft, originTop, dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".bk-icon-btn")) return;
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
    enableDrag(root.querySelector("[data-bk-drag]"));

    root.querySelector("[data-bk-panic]").addEventListener("click", panic);
    root.querySelector("[data-bk-refresh]").addEventListener("click", async () => {
      const res = await send(MSG.REFRESH_MATCHES);
      matches = (res && res.matches) || matches;
      renderMatch();
    });
    root.querySelector("[data-bk-prev]").addEventListener("click", () => {
      if (!matches.length) return;
      activeIndex = (activeIndex - 1 + matches.length) % matches.length;
      renderMatch();
    });
    root.querySelector("[data-bk-next]").addEventListener("click", () => {
      if (!matches.length) return;
      activeIndex = (activeIndex + 1) % matches.length;
      renderMatch();
    });
    root.querySelector("[data-bk-excuse]").addEventListener("click", onExcuse);
  }

  async function onExcuse() {
    const out = root.querySelector(".bk-excuse-out");
    out.hidden = false;
    out.textContent = "Thinking\u2026";
    const m = matches[activeIndex];
    const context = m
      ? `${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}, ${m.minute || ""}'`
      : "a tense moment";
    const res = await send(MSG.GENERATE_EXCUSE, { context });
    out.textContent = res && res.ok ? res.excuse : (res?.error || "Could not generate.");
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
      settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE.SETTINGS].newValue };
      if (visible) renderMatch();
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
