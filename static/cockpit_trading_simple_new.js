(() => {

  // =========================
  // API BASE (CRITICAL FIX)
  // =========================
  function getApiRoot() {
    const host = window.location.hostname;

    // LOCAL (dev)
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://127.0.0.1:8000";
    }

    // PROD (Cloudflare Pages → Tunnel backend)
    return "https://api.quantumyield.ai";
  }

  const API_ROOT = getApiRoot();
  
  // =========================
  // CONFIG
  // =========================
  function apiBase(mode) {
    if (mode === "live") return `${API_ROOT}/api/live`;
    if (mode === "worker") return `${API_ROOT}/api/worker`;
    return `${API_ROOT}/api`;
  }

  function snapshotPath(mode) {
    return `${apiBase(mode)}/cockpit/today_snapshot`;
  }

  // =========================
  // ELEMENTS
  // =========================
  const el = {
    symbolSelect: document.getElementById("symbolSelect"),
    modeSelect: document.getElementById("modeSelect"),
    viewMode: document.getElementById("viewMode"),

    todayPill: document.getElementById("todayPill"),
    tsPill: document.getElementById("tsPill"),

    pnlMeasure: document.getElementById("pnlMeasure"),

    hAllBtn: document.getElementById("hAllBtn"),
    hNoneBtn: document.getElementById("hNoneBtn"),

    horizonsBox: document.getElementById("horizonsBox"),
    combinedTable: document.getElementById("combinedTable"),
    healthTable: document.getElementById("healthTable"),
    predictionStatsTable: document.getElementById("predictionTable"),
    sessionSelect: document.getElementById("sessionSelect"),

    dbgLog: document.getElementById("dbgLog"),
    dbgMeta: document.getElementById("dbgMeta"),
  };

  // =========================
  // STATE
  // =========================
  const state = {
    horizons: [],
    selectedHorizons: new Set(),
    countsByH: {},
    contractsByH: {},
    viewMode: "trade",
    pnlByH: {},
    netByH: {},
    logs: [],
    timer: null,
    _initializedHorizons: false
  };
  window.__state = state;

  // =========================
  // LOG
  // =========================
  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.push(line);
    if (state.logs.length > 200) state.logs.shift();

    if (el.dbgLog) el.dbgLog.textContent = state.logs.join("\n");
    if (el.dbgMeta) el.dbgMeta.textContent = `logs=${state.logs.length}`;

    console.log(line);
  }

  // =========================
  // UTILS
  // =========================
  function fmtNum(v, d = 0) {
    return Number(v || 0).toLocaleString(undefined, {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }

  function fmtSigned(v) {
    const n = Number(v || 0);
    if (n === 0) return "0";
    return (n > 0 ? "+" : "") + fmtNum(n);
  }

  function getSymbol() {
    return el.symbolSelect.value || "ES";
  }

  function getMode() {
    return el.modeSelect.value || "live";
  }

  // =========================
  // DATA ACCESS
  // =========================
  function cGet(h, sym, bucket, status) {
    return Number(state.countsByH?.[String(h)]?.[sym]?.[bucket]?.[status] || 0);
  }

  function ctGet(h, sym, bucket, status) {
    return Number(state.contractsByH?.[String(h)]?.[sym]?.[bucket]?.[status] || 0);
  }

  window.__ctGet = ctGet;
  window.__cGet = cGet;

  function pGet(h, sym, bucket, measure) {
    return Number(state.pnlByH?.[h]?.[sym]?.[bucket]?.[measure] || 0);
  }

  function nGet(h, sym) {

    // OPEN LONG exposure
    const longOpen =
      state.viewMode === "position"
        ? ctGet(h, sym, "L", "OPEN")
        : cGet(h, sym, "L", "OPEN");

    // OPEN SHORT exposure
    const shortOpen =
      state.viewMode === "position"
        ? ctGet(h, sym, "S", "OPEN")
        : cGet(h, sym, "S", "OPEN");

    // Net exposure
    return Number(longOpen) - Number(shortOpen);
  }

  function vGet(h, sym, bucket, status) {
    return state.viewMode === "position"
      ? ctGet(h, sym, bucket, status)
      : cGet(h, sym, bucket, status);
  }

  function normalizeNet(p) {
    return p.net || {};
  }

  // =========================
  // HORIZONS
  // =========================
  function reconcileHorizons() {
    if (!state._initializedHorizons) {
      state.horizons.forEach(h => state.selectedHorizons.add(h));
      state._initializedHorizons = true;
    }
  }

  function renderHorizons() {
    el.horizonsBox.innerHTML = state.horizons.map(h => {
      const checked = state.selectedHorizons.has(h) ? "checked" : "";
      return `
        <label class="hitem">
          <input type="checkbox" data-h="${h}" ${checked}/>
          ${h}
        </label>
      `;
    }).join("");

    el.horizonsBox.querySelectorAll("input").forEach(cb => {
      cb.addEventListener("change", e => {
        const h = Number(e.target.dataset.h);

        if (e.target.checked) state.selectedHorizons.add(h);
        else state.selectedHorizons.delete(h);

        renderCombinedTable();

        if (window.__lastPredictionData) {
          renderPredictionStats(window.__lastPredictionData);
        }
      });
    });
  }

  // =========================
  // MAIN TABLE
  // =========================
  function renderCombinedTable() {
    const sym = getSymbol();
    const measure = el.pnlMeasure.value;

    const horizons = state.horizons.filter(h => state.selectedHorizons.has(h));

    const rows = horizons.map(h => {

      const getVal = (bucket, status) => vGet(h, sym, bucket, status);

      return `
        <tr>
          <td>${h}</td>
          <td>${fmtNum(getVal("T","OPEN"))}</td>
          <td>${fmtNum(getVal("T","CLOSED"))}</td>
          <td>${fmtNum(getVal("L","OPEN"))}</td>
          <td>${fmtNum(getVal("S","OPEN"))}</td>
          <td>${fmtSigned(nGet(h,sym))}</td>
          <td>${fmtNum(pGet(h,sym,"T",measure),2)}</td>
          <td>${fmtNum(pGet(h,sym,"L",measure),2)}</td>
          <td>${fmtNum(pGet(h,sym,"S",measure),2)}</td>
        </tr>
      `;
    });

    el.combinedTable.innerHTML = `
      <thead>
        <tr>
          <th>H</th><th>Open</th><th>Closed</th>
          <th>Long</th><th>Short</th><th>Net</th>
          <th>Total</th><th>Long</th><th>Short</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    `;
  }

  // =========================
  // HEALTH
  // =========================
  function renderHealth(data) {

    const predSummary = window.__predSummary || {};
    const session = el.sessionSelect?.value || "FULL";

    const feeds = ["HFT","IDT"];

    function detectMode(ts) {

      if (!ts) return "UNKNOWN";

      try {

        const d = new Date(ts);
        const now = new Date();

        const sameDay =
          d.getUTCFullYear() === now.getUTCFullYear() &&
          d.getUTCMonth() === now.getUTCMonth() &&
          d.getUTCDate() === now.getUTCDate();

        return sameDay ? "LIVE" : "SIMULATION";

      } catch(e) {

        return "UNKNOWN";
      }
    }

    function extractDate(ts) {

      if (!ts) return "-";

      try {

        const d = new Date(ts);

        return (
          d.getUTCFullYear() + "-" +
          String(d.getUTCMonth() + 1).padStart(2,"0") + "-" +
          String(d.getUTCDate()).padStart(2,"0")
        );

      } catch(e) {

        return "-";
      }
    }

    const body = feeds.map(feed => {

      const pred =
        predSummary?.[session]?.[feed] ||
        predSummary?.["FULL"]?.[feed] ||
        {};

      // =====================================
      // TRUE STREAM SOURCE = INFERENCE CSV
      // =====================================
      const firstTs =
        pred.first_ts_et ||
        pred.first_ts ||
        "-";

      const lastTs =
        pred.last_ts_et ||
        pred.last_ts ||
        "-";

      const rows = pred.rows ?? "-";

      const modeLabel = detectMode(lastTs);
      const runDate = extractDate(lastTs);

      return `
        <tr>

          <td>
            <strong>${feed} (Inference Stream)</strong><br>
            Source: prediction CSV<br>
            Refresh: ${new Date().toLocaleTimeString()}
          </td>

          <td>
            <strong>${feed} (${modeLabel})</strong><br>
            Run Date: ${runDate}<br>
            First TS: ${firstTs}<br>
            Last TS: ${lastTs}<br>
            Rows: ${rows}
          </td>

        </tr>
      `;

    }).join("");

    el.healthTable.innerHTML = `
      <thead>
        <tr>
          <th>Stream Status</th>
          <th>Inference Dataset</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    `;
  }

  // =========================
  // PREDICTION STATS
  // =========================
  function renderPredictionStats(data) {

    if (!data?.prediction_stats) return;

    const session = el.sessionSelect.value || "FULL";
    const sessionData = data.prediction_stats[session] || {};

    const merged = {};

    ["HFT","IDT"].forEach(model => {
      const m = sessionData[model] || {};

      for (const h in m) {
        const cur = m[h];
        if (!cur || cur.counts <= 0) continue;

        if (!merged[h]) {
          merged[h] = { ...cur };
        } else {
          // 🔥 aggregate instead of overwrite
          merged[h].counts += cur.counts;
          merged[h].pos += cur.pos;
          merged[h].neg += cur.neg;

          merged[h].z_buy += cur.z_buy;
          merged[h].z_sell += cur.z_sell;
          merged[h].z_hold += cur.z_hold;

          // recompute later if needed
        }
      }
    });

    // ✅ recompute derived metrics after merge
    for (const h in merged) {
      const s = merged[h];

      s.pos_pct = s.counts ? s.pos / s.counts : 0;
      s.neg_pct = s.counts ? s.neg / s.counts : 0;

      const totalZ = s.z_buy + s.z_sell + s.z_hold;

      s.z_buy_pct = totalZ ? s.z_buy / totalZ : 0;
      s.z_sell_pct = totalZ ? s.z_sell / totalZ : 0;

      s.z_direction_bias = totalZ
        ? (s.z_buy - s.z_sell) / totalZ
        : 0;
    }

    const selected = state.selectedHorizons;

    const rows = Object.keys(merged)
      .map(Number)
      .filter(h => selected.size === 0 ? false : selected.has(h)) // 🔥 FIXED
      .sort((a,b)=>a-b)
      .map(h => {
        const s = merged[h];
        return `<tr>
          <td>${h}</td>
          <td>${s.counts}</td>
          <td>${s.pos}</td>
          <td>${s.neg}</td>
          <td>${(s.pos_pct*100).toFixed(1)}%</td>
          <td>${(s.neg_pct*100).toFixed(1)}%</td>
          <td>${s.mean.toFixed(4)}</td>
          <td>${s.min.toFixed(4)}</td>
          <td>${s.max.toFixed(4)}</td>
          <td>${s.direction_bias.toFixed(3)}</td>
          <td>${(s.skew_last_horizon||0).toFixed(3)}</td>
          <td>${s.z_buy}</td>
          <td>${s.z_sell}</td>
          <td>${s.z_hold}</td>
          <td>${(s.z_buy_pct*100).toFixed(1)}%</td>
          <td>${(s.z_sell_pct*100).toFixed(1)}%</td>
          <td>${s.z_direction_bias.toFixed(3)}</td>
        </tr>`;
      });

    el.predictionStatsTable.innerHTML = `
      <thead>
        <tr>
          <th>H</th><th>N</th><th>Pos</th><th>Neg</th>
          <th>Pos%</th><th>Neg%</th>
          <th>Mean</th><th>Min</th><th>Max</th>
          <th>Bias</th><th>Skew</th>
          <th>Z Buy</th><th>Z Sell</th><th>Z Hold</th>
          <th>Z Buy%</th><th>Z Sell%</th><th>Z Bias</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    `;
  }

  // =========================
  // FETCH
  // =========================
  async function fetchPredictionStats() {
    const res = await fetch(`${apiBase(getMode())}/cockpit/prediction_stats?symbol=${getSymbol()}`);
    if (!res.ok) return null;
    return await res.json();
  }

  // =========================
  // REFRESH
  // =========================
  async function refreshAll() {
    try {

      const res = await fetch(`${snapshotPath(getMode())}?symbols=${getSymbol()}`);
      const data = await res.json();

      const pred = await fetchPredictionStats();

      window.__lastPredictionData = pred;
      window.__predSummary = pred?.summary || {};

      state.horizons = data.meta.horizons_ms || [];
      state.countsByH = data.counts.by_horizon || {};
      state.contractsByH = data.contracts?.by_horizon || {};
      state.pnlByH = data.pnl.by_horizon || {};
      state.netByH = normalizeNet(data);

      reconcileHorizons();

      renderHorizons();
      renderCombinedTable();
      renderHealth(data);
      renderPredictionStats(pred);

      const predSummary = window.__predSummary || {};

      const hft =
        predSummary?.FULL?.HFT ||
        {};

      const idt =
        predSummary?.FULL?.IDT ||
        {};

      const anchorTs =
        hft.last_ts_et ||
        idt.last_ts_et ||
        hft.last_ts ||
        idt.last_ts ||
        null;

      if (anchorTs) {

        try {

          const d = new Date(anchorTs);

          const ymd =
            d.getUTCFullYear() +
            String(d.getUTCMonth() + 1).padStart(2, "0") +
            String(d.getUTCDate()).padStart(2, "0");

          el.todayPill.textContent = `RUN DATE: ${ymd}`;

        } catch(e) {

          el.todayPill.textContent =
            `RUN DATE: ${data.meta.trading_date || "-"}`;
        }

      } else {

        el.todayPill.textContent =
          `RUN DATE: ${data.meta.trading_date || "-"}`;
      }
      el.tsPill.textContent = `Updated: ${new Date().toLocaleTimeString()}`;

      log("refresh OK");

    } catch (e) {
      console.error(e);
      log(e.message);
    }
  }

  // =========================
  // BUTTONS
  // =========================
  el.hAllBtn?.addEventListener("click", () => {
    state.selectedHorizons = new Set(state.horizons);
    renderHorizons();
    renderCombinedTable();
    renderPredictionStats(window.__lastPredictionData);
  });

  el.hNoneBtn?.addEventListener("click", () => {
    state.selectedHorizons.clear();
    renderHorizons();
    renderCombinedTable();
    renderPredictionStats(window.__lastPredictionData);
  });

  el.viewMode?.addEventListener("change", () => {
    state.viewMode = el.viewMode.value;
    renderCombinedTable();
  });

  // =========================
  // INIT
  // =========================
  state.timer = setInterval(refreshAll, 5000);
  refreshAll();

})();
