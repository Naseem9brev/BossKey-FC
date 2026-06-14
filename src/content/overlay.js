/*
 * BossKey FC — content overlay.
 *
 * Draws a draggable "score HUD" on top of any page. The card markup (native
 * football skin + Slack/Jira/Linear/Sheets disguises) is produced by the
 * shared renderer in src/shared/hud.js so the overlay and popup stay identical.
 * Panic key (Escape) hides it instantly; Alt+W toggles it.
 */
(function () {
  const { STORAGE, MSG, DEFAULT_SETTINGS } = window.BOSSKEY_CONFIG;
  const HUD = window.BOSSKEY_HUD;

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

  function current() {
    return matches[activeIndex] || null;
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
    const out = HUD.render({
      settings,
      matches,
      activeIndex,
      activeTab,
      standings: standingsData,
      statsLoading,
      statsError
    });
    root.className = out.className;
    card.innerHTML = out.html;
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
    if (!skin || !HUD.SKINS[skin] || skin === settings.disguise) return;
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
