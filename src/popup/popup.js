/* BossKey FC — popup settings + live preview. */
(function () {
  const { STORAGE, MSG, DEFAULT_SETTINGS } = window.BOSSKEY_CONFIG;

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
    source: document.getElementById("source"),
    refresh: document.getElementById("refresh"),
    excuse: document.getElementById("excuse"),
    excuseOut: document.getElementById("excuseOut"),
    status: document.getElementById("status")
  };

  let settings = { ...DEFAULT_SETTINGS };
  let matches = [];

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

  function renderScores(meta) {
    if (!matches.length) {
      els.scores.textContent = "No matches available.";
      return;
    }
    els.scores.innerHTML = matches
      .map(
        (m) => `
        <div class="row">
          <span class="nm">${esc(m.home.code || m.home.name)} v ${esc(m.away.code || m.away.name)}</span>
          <span class="sc">${m.home.score}-${m.away.score}</span>
          <span class="st">${esc(m.status)}${m.minute != null ? " " + m.minute + "'" : ""}</span>
        </div>`
      )
      .join("");
    if (meta) {
      const when = new Date(meta.at).toLocaleTimeString();
      els.source.textContent = `${meta.live ? "Live" : "Sample"} data \u00b7 updated ${when}`;
    }
  }

  async function loadScores(force) {
    const res = await send(force ? MSG.REFRESH_MATCHES : MSG.GET_MATCHES);
    matches = (res && res.matches) || [];
    renderScores(res && res.meta);
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
    settings.disguise = btn.dataset.mode;
    paintDisguise();
    save();
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

  els.excuse.addEventListener("click", async () => {
    els.excuseOut.hidden = false;
    els.excuseOut.textContent = "Thinking\u2026";
    const m = matches[0];
    const context = m
      ? `${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}, ${m.minute || ""}'`
      : "a tense moment";
    const res = await send(MSG.GENERATE_EXCUSE, { context });
    els.excuseOut.textContent = res && res.ok ? res.excuse : (res?.error || "Could not generate.");
    if (!res?.ok && !settings.groqApiKey) setActiveTab("settings");
  });

  /* init */
  setActiveTab("dashboard");
  load().then(() => loadScores(false));
})();
