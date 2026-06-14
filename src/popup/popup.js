/* BossKey FC — popup. Renders the live HUD (same renderer as the on-page
 * overlay) so the popup itself morphs into each disguise, plus settings. */
(function () {
  const { STORAGE, MSG, DEFAULT_SETTINGS, flagEmoji } = window.BOSSKEY_CONFIG;
  const HUD = window.BOSSKEY_HUD;
  const flag = (c) => (flagEmoji ? flagEmoji(c) : "\u26BD");

  const els = {
    tabs: [...document.querySelectorAll(".tab")],
    panels: [...document.querySelectorAll(".tab-panel")],
    enabled: document.getElementById("enabled"),
    disguise: document.getElementById("disguise"),
    favoriteTeam: document.getElementById("favoriteTeam"),
    pollMinutes: document.getElementById("pollMinutes"),
    scoresEndpoint: document.getElementById("scoresEndpoint"),
    groqApiKey: document.getElementById("groqApiKey"),
    clearGroqApiKey: document.getElementById("clearGroqApiKey"),
    scores: document.getElementById("scores"),
    liveCount: document.getElementById("liveCount"),
    source: document.getElementById("source"),
    refresh: document.getElementById("refresh"),
    hudRoot: document.getElementById("bk-overlay"),
    hudCard: document.querySelector("#bk-overlay .bk-card"),
    status: document.getElementById("status")
  };

  let settings = { ...DEFAULT_SETTINGS };
  let matches = [];
  let popupPort = null;

  // Live HUD state (mirrors the overlay's local state).
  let hudIndex = 0;
  let hudTab = "score";
  let standings = null;
  let statsLoading = false;
  let statsError = null;

  function send(type, extra = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...extra }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res);
      });
    });
  }

  function setActiveTab(tab) {
    els.tabs.forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", String(on));
    });
    els.panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab;
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  async function load() {
    const stored = await chrome.storage.sync.get(STORAGE.SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE.SETTINGS] || {}) };

    els.enabled.checked = !!settings.enabled;
    els.favoriteTeam.value = settings.favoriteTeam || "";
    els.pollMinutes.value = settings.pollMinutes || 1;
    els.scoresEndpoint.value = settings.scoresEndpoint || "";
    els.groqApiKey.value = settings.groqApiKey || "";
    paintDisguise();
  }

  function paintDisguise() {
    els.disguise.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.mode === settings.disguise);
    });
  }

  async function save(flash = true) {
    await chrome.storage.sync.set({ [STORAGE.SETTINGS]: settings });
    await send(MSG.SETTINGS_CHANGED);
    if (flash) {
      els.status.textContent = "Saved";
      setTimeout(() => (els.status.textContent = ""), 1200);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Live HUD (same renderer as the on-page overlay)                  */
  /* ---------------------------------------------------------------- */
  function current() {
    return matches[hudIndex] || null;
  }

  function renderHud() {
    if (!HUD || !els.hudRoot || !els.hudCard) return;
    if (hudIndex >= matches.length) hudIndex = 0;
    const out = HUD.render({
      settings,
      matches,
      activeIndex: hudIndex,
      activeTab: hudTab,
      standings,
      statsLoading,
      statsError
    });
    els.hudRoot.className = out.className;
    els.hudCard.innerHTML = out.html;
    wireHud();
  }

  function wireHud() {
    const card = els.hudCard;

    card.querySelectorAll("[data-bk-panic]").forEach((el) =>
      el.addEventListener("click", (e) => { e.stopPropagation(); closePopup(); }));

    const refresh = card.querySelector("[data-bk-refresh]");
    if (refresh) refresh.addEventListener("click", (e) => {
      e.stopPropagation();
      loadScores(true);
    });

    card.querySelectorAll("[data-bk-next]").forEach((el) =>
      el.addEventListener("click", () => {
        if (!matches.length) return;
        hudIndex = (hudIndex + 1) % matches.length;
        renderHud();
      }));

    card.querySelectorAll("[data-bk-prev]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!matches.length) return;
        hudIndex = (hudIndex - 1 + matches.length) % matches.length;
        renderHud();
      }));

    card.querySelectorAll("[data-bk-tab]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const tab = el.dataset.bkTab;
        if (tab === hudTab) return;
        hudTab = tab;
        renderHud();
        if (tab === "stats") loadStandings();
      }));

    const excuse = card.querySelector("[data-bk-excuse]");
    if (excuse) excuse.addEventListener("click", (e) => { e.stopPropagation(); onExcuse(); });

    card.querySelectorAll("[data-bk-skin]").forEach((el) =>
      el.addEventListener("click", (e) => { e.stopPropagation(); setDisguise(el.dataset.bkSkin); }));
  }

  function setDisguise(skin) {
    if (!skin || !HUD.SKINS[skin] || skin === settings.disguise) return;
    settings.disguise = skin;
    paintDisguise();
    renderHud();
    save(false);
  }

  async function loadStandings() {
    if (standings) {
      if (hudTab === "stats") renderHud();
      return;
    }
    statsLoading = true;
    statsError = null;
    renderHud();
    const res = await send(MSG.GET_STANDINGS);
    statsLoading = false;
    if (!res || !res.ok) statsError = (res && res.error) || "Could not load standings.";
    else { standings = res.groups || []; statsError = null; }
    renderHud();
  }

  async function onExcuse() {
    const out = els.hudCard.querySelector(".bk-excuse-out");
    if (out) {
      out.hidden = false;
      out.textContent = "Thinking\u2026";
    }
    const m = current();
    const context = m
      ? `${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}, ${m.minute || ""}'`
      : "a tense moment";
    const res = await send(MSG.GENERATE_EXCUSE, { context });
    const ok = res && res.ok;
    if (out) out.textContent = ok ? res.excuse : (res?.error || "Could not generate.");
    if (!ok && !settings.groqApiKey) setActiveTab("settings");
  }

  /* ---------------------------------------------------------------- */
  /* "Live now" overview list                                         */
  /* ---------------------------------------------------------------- */
  function statusBits(m) {
    const s = (m.status || "").toUpperCase();
    if (s === "LIVE") return { cls: "live", txt: m.minute != null ? `${m.minute}'` : "LIVE" };
    if (s === "HT") return { cls: "ht", txt: "HT" };
    if (s === "FT") return { cls: "ft", txt: "FT" };
    return { cls: "sched", txt: "\u2014" };
  }

  function renderScores(meta) {
    if (!matches.length) {
      els.scores.textContent = "No matches available.";
      els.liveCount.hidden = true;
      return;
    }
    els.scores.innerHTML = matches
      .map((m) => {
        const st = statusBits(m);
        return `
        <div class="row">
          <span class="tm"><span class="fl">${flag(m.home.code)}</span>${esc(m.home.code || m.home.name)}</span>
          <span class="sc">${esc(m.home.score)}<i>:</i>${esc(m.away.score)}</span>
          <span class="tm ta">${esc(m.away.code || m.away.name)}<span class="fl">${flag(m.away.code)}</span></span>
          <span class="st st-${st.cls}">${st.cls === "live" ? '<i class="dot"></i>' : ""}${esc(st.txt)}</span>
        </div>`;
      })
      .join("");
    const liveN = matches.filter((m) => (m.status || "").toUpperCase() === "LIVE").length;
    els.liveCount.hidden = liveN === 0;
    els.liveCount.textContent = `${liveN} live`;
    if (meta) {
      const when = new Date(meta.at).toLocaleTimeString();
      els.source.textContent = `${meta.live ? "Live" : "Sample"} data \u00b7 updated ${when}`;
    }
  }

  async function loadScores(force) {
    const res = await send(force ? MSG.REFRESH_MATCHES : MSG.GET_MATCHES);
    matches = (res && res.matches) || [];
    renderScores(res && res.meta);
    renderHud();
  }

  function closePopup() {
    window.close();
  }

  function wirePopupShortcut() {
    try {
      popupPort = chrome.runtime.connect({ name: "bosskey-popup" });
      popupPort.onMessage.addListener((message) => {
        if (message?.type === MSG.CLOSE_POPUP) closePopup();
      });
    } catch {
      popupPort = null;
    }

    document.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      const shortcut = key === "b" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (!shortcut) return;
      e.preventDefault();
      closePopup();
    });
  }

  /* events */
  els.tabs.forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  els.enabled.addEventListener("change", () => {
    settings.enabled = els.enabled.checked;
    save();
  });

  els.disguise.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    setDisguise(btn.dataset.mode);
  });

  [["favoriteTeam", "favoriteTeam"], ["scoresEndpoint", "scoresEndpoint"], ["groqApiKey", "groqApiKey"]]
    .forEach(([key, id]) => {
      els[id].addEventListener("change", () => {
        settings[key] = els[id].value.trim();
        save();
      });
    });

  els.clearGroqApiKey.addEventListener("click", () => {
    settings.groqApiKey = "";
    els.groqApiKey.value = "";
    save();
  });

  els.pollMinutes.addEventListener("change", () => {
    settings.pollMinutes = Math.max(0.5, parseFloat(els.pollMinutes.value) || 1);
    save();
  });

  els.refresh.addEventListener("click", () => {
    els.scores.textContent = "Refreshing\u2026";
    loadScores(true);
  });

  /* init */
  setActiveTab("dashboard");
  wirePopupShortcut();
  load().then(() => {
    renderHud();
    loadScores(false);
  });
})();
