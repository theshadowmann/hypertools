import { fmtQty, num } from "./format.js";
import { formatFillTime, buildTradeHistoryTable } from "./fills.js";

/** HH:MM:SS from total seconds. */
export function formatHms(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return pad(h) + ":" + pad(m) + ":" + pad(sec);
}

export function twapStatusRaw(rec) {
  if (!rec) return "";
  if (typeof rec.status === "string") return rec.status;
  if (rec.status && rec.status.status != null) return String(rec.status.status);
  return "";
}

/** HL-style Title case status label. */
export function twapStatusLabel(recOrStatus) {
  const raw =
    typeof recOrStatus === "string" ? recOrStatus : twapStatusRaw(recOrStatus);
  if (!raw) return "—";
  const s = String(raw);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isTwapActiveStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "activated" || s === "waitingfortrigger";
}

export function twapStateOf(rec) {
  if (!rec) return {};
  if (rec.state && typeof rec.state === "object") return rec.state;
  return rec;
}

export function twapIdOf(rec) {
  if (!rec) return null;
  if (rec.twapId != null) return Number(rec.twapId);
  if (rec.id != null) return Number(rec.id);
  return null;
}

/** Dedup / latest-history key: prefer twapId, else coin + start timestamp. */
export function twapRecKey(rec) {
  const id = twapIdOf(rec);
  if (Number.isFinite(id)) return "id:" + id;
  const state = twapStateOf(rec);
  return "coin:" + (state.coin || "") + ":" + (state.timestamp || "");
}

/** History record time as ms (HL `time` is seconds; state.timestamp is ms). */
export function twapHistoryTimeMs(rec) {
  const t = num(rec && rec.time);
  if (Number.isFinite(t) && t > 0) return t < 1e12 ? t * 1000 : t;
  return twapCreationMs(twapStateOf(rec), rec) || 0;
}

/**
 * twapHistory is a lifecycle event log: one row per status change for the same
 * twapId (activated, then finished/terminated, …). Keep the latest row per id.
 */
export function latestTwapHistoryById(hist) {
  const byKey = new Map();
  (Array.isArray(hist) ? hist : []).forEach((rec) => {
    if (!rec) return;
    const key = twapRecKey(rec);
    const prev = byKey.get(key);
    if (!prev || twapHistoryTimeMs(rec) >= twapHistoryTimeMs(prev)) {
      byKey.set(key, rec);
    }
  });
  return byKey;
}

/** Average fill px from executedNtl / executedSz when both present. */
export function twapAvgPx(state) {
  const ntl = num(state && state.executedNtl);
  const sz = num(state && state.executedSz);
  if (!Number.isFinite(ntl) || !Number.isFinite(sz) || sz <= 0) return null;
  return ntl / sz;
}

export function formatTwapPx(raw) {
  if (raw == null || raw === "") return "—";
  const px = num(raw);
  if (!Number.isFinite(px)) return "—";
  return px.toLocaleString("en-US", {
    minimumFractionDigits: px >= 1000 ? 2 : px >= 1 ? 2 : px >= 0.01 ? 4 : 6,
    maximumFractionDigits: px >= 1000 ? 2 : px >= 1 ? 2 : px >= 0.01 ? 4 : 6,
  });
}

export function twapSizeLabel(sz, coin) {
  if (sz == null || sz === "") return "—";
  const q = fmtQty(sz);
  if (q === "—") return "—";
  const c = coin != null && String(coin) ? String(coin) : "";
  return c ? q + " " + c : q;
}

export function twapTriggerPx(state) {
  const t = state && state.trigger;
  if (t && typeof t === "object" && t.px != null && t.px !== "") return t.px;
  return null;
}

/**
 * HL UI label is Max/Min Price; Info TwapState only documents stopPx.
 * Prefer minPx/maxPx if present, else stopPx, else —.
 */
export function twapMaxMinLabel(state) {
  const min = state && (state.minPx != null ? state.minPx : state.minPrice);
  const max = state && (state.maxPx != null ? state.maxPx : state.maxPrice);
  if (min != null && min !== "" && max != null && max !== "") {
    return formatTwapPx(min) + " / " + formatTwapPx(max);
  }
  if (state && state.stopPx != null && state.stopPx !== "") return formatTwapPx(state.stopPx);
  return "—";
}

export function twapYesNo(flag) {
  return flag ? "Yes" : "No";
}

export function twapPlannedSec(state) {
  const m = num(state && state.minutes);
  if (!Number.isFinite(m) || m <= 0) return NaN;
  return m * 60;
}

export function twapElapsedSec(state, now = Date.now()) {
  const start = num(state && state.timestamp);
  if (!Number.isFinite(start) || start <= 0) return NaN;
  return Math.max(0, (now - start) / 1000);
}

/**
 * End conditions when status still says activated: duration elapsed or size filled.
 * Used only for history fallback — live twapStates are authoritative.
 */
export function isTwapStillRunning(state, now = Date.now()) {
  const planned = twapPlannedSec(state);
  const elapsed = twapElapsedSec(state, now);
  if (Number.isFinite(planned) && Number.isFinite(elapsed) && elapsed >= planned) return false;
  const sz = num(state && state.sz);
  const exec = num(state && state.executedSz);
  if (Number.isFinite(sz) && sz > 0 && Number.isFinite(exec) && exec + 1e-12 >= sz) return false;
  return true;
}

/** Active column: running / total as HH:MM:SS / HH:MM:SS. */
export function twapRunningLabel(state, now = Date.now()) {
  const elapsed = twapElapsedSec(state, now);
  const total = twapPlannedSec(state);
  if (!Number.isFinite(elapsed) || !Number.isFinite(total)) return "—";
  return formatHms(Math.min(elapsed, total)) + " / " + formatHms(total);
}

/**
 * History Total Runtime: planned while activated; for finished/terminated try
 * record.time (sec or ms) − state.timestamp when that duration is sensible.
 */
export function twapHistoryRuntimeLabel(rec, now = Date.now()) {
  const state = twapStateOf(rec);
  const status = twapStatusRaw(rec);
  const planned = twapPlannedSec(state);
  if (isTwapActiveStatus(status) || !status) {
    return Number.isFinite(planned) ? formatHms(planned) : "—";
  }
  const endRaw = num(rec && rec.time);
  const start = num(state.timestamp);
  if (Number.isFinite(endRaw) && endRaw > 0 && Number.isFinite(start) && start > 0) {
    const endMs = endRaw < 1e12 ? endRaw * 1000 : endRaw;
    const dur = Math.max(0, (endMs - start) / 1000);
    if (dur > 0 && (!Number.isFinite(planned) || dur <= planned * 1.5 + 60)) {
      return formatHms(dur);
    }
  }
  const elapsed = twapElapsedSec(state, now);
  if (Number.isFinite(elapsed) && Number.isFinite(planned)) {
    return formatHms(Math.min(elapsed, planned));
  }
  return Number.isFinite(planned) ? formatHms(planned) : "—";
}

export function twapCreationMs(state, rec) {
  const ts = num(state && state.timestamp);
  if (Number.isFinite(ts) && ts > 0) return ts;
  const t = num(rec && rec.time);
  if (!Number.isFinite(t) || t <= 0) return NaN;
  return t < 1e12 ? t * 1000 : t;
}

/**
 * Active rows: live twapStates (array, incl. empty) are authoritative when
 * provided. Pass null/undefined for live to fall back to twapHistory — using
 * the latest status per twapId so old "activated" lifecycle rows do not stay
 * Active after finished/terminated, plus end-condition guards.
 */
export function collectActiveTwaps(live, hist, now = Date.now()) {
  const byId = new Map();
  const push = (rec, source, statusOverride) => {
    const id = twapIdOf(rec);
    const state = twapStateOf(rec);
    const key = twapRecKey(rec);
    if (byId.has(key) && source === "hist") return;
    byId.set(key, {
      id: Number.isFinite(id) ? id : null,
      state,
      status:
        statusOverride != null
          ? statusOverride
          : source === "live"
            ? "activated"
            : twapStatusRaw(rec) || "activated",
      source,
      raw: rec,
    });
  };

  if (Array.isArray(live)) {
    live.forEach((t) => push(t, "live"));
    return Array.from(byId.values());
  }

  latestTwapHistoryById(hist).forEach((rec) => {
    const status = twapStatusRaw(rec);
    if (!isTwapActiveStatus(status)) return;
    if (!isTwapStillRunning(twapStateOf(rec), now)) return;
    push(rec, "hist", status);
  });
  return Array.from(byId.values());
}

export function collectHistoryTwaps(hist) {
  return (Array.isArray(hist) ? hist.slice() : []).sort((a, b) => {
    const ta = twapHistoryTimeMs(a) || twapCreationMs(twapStateOf(a), a) || 0;
    const tb = twapHistoryTimeMs(b) || twapCreationMs(twapStateOf(b), b) || 0;
    return tb - ta;
  });
}

/** Unwrap userTwapSliceFills → fill objects (with twapId) for Trade History table. */
export function unwrapTwapSliceFills(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      if (!r) return null;
      if (r.fill && typeof r.fill === "object") {
        return { ...r.fill, twapId: r.twapId != null ? r.twapId : r.fill.twapId };
      }
      return r;
    })
    .filter(Boolean);
}

/**
 * @param {typeof import("./dom.js").h} h
 */
export function buildTwapActiveTable(h, rows, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const canTerminate = !!opts.canTerminate;
  const onTerminate = opts.onTerminate;
  const headers = [
    "Market",
    "Size",
    "Executed Size",
    "Average Price",
    "Running Time / Total",
    "Trigger Price",
    "Max/Min Price",
    "Reduce Only",
    "Creation Time",
    "Terminate",
  ];
  const body = (Array.isArray(rows) ? rows : []).map((row) => {
    const st = row.state || {};
    const coin = st.coin || "—";
    const avg = twapAvgPx(st);
    const trig = twapTriggerPx(st);
    const execSz = st.executedSz;
    const hasExec = num(execSz) > 0;
    return h(
      "tr",
      null,
      h("td", { class: "px-2 py-1.5 text-accent font-medium" }, coin),
      h("td", { class: "px-2 py-1.5 font-mono text-accent" }, twapSizeLabel(st.sz, st.coin)),
      h(
        "td",
        { class: "px-2 py-1.5 font-mono" + (hasExec ? " text-accent" : " text-mist-400") },
        hasExec ? twapSizeLabel(execSz, st.coin) : "—"
      ),
      h("td", { class: "px-2 py-1.5 font-mono" }, avg != null ? formatTwapPx(avg) : "—"),
      h("td", { class: "px-2 py-1.5 font-mono whitespace-nowrap" }, twapRunningLabel(st, now)),
      h("td", { class: "px-2 py-1.5 font-mono text-mist-400" }, trig != null ? formatTwapPx(trig) : "—"),
      h("td", { class: "px-2 py-1.5 font-mono text-mist-400" }, twapMaxMinLabel(st)),
      h("td", { class: "px-2 py-1.5" }, twapYesNo(!!st.reduceOnly)),
      h(
        "td",
        { class: "px-2 py-1.5 text-mist-400 whitespace-nowrap" },
        formatFillTime(twapCreationMs(st, row.raw))
      ),
      h(
        "td",
        { class: "px-2 py-1.5 orders-cancel-cell" },
        canTerminate && row.id != null && typeof onTerminate === "function"
          ? h(
              "button",
              {
                type: "button",
                class: "orders-cancel",
                onClick: () => onTerminate(st.coin || "", Number(row.id)),
              },
              "Terminate"
            )
          : ""
      )
    );
  });
  return h(
    "div",
    { class: "overflow-x-auto" },
    h(
      "table",
      { class: "bal-table" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          ...headers.map((label, i) =>
            h("th", i === headers.length - 1 ? { class: "orders-cancel-h" } : null, label)
          )
        )
      ),
      h("tbody", null, ...body)
    )
  );
}

/**
 * @param {typeof import("./dom.js").h} h
 */
export function buildTwapHistoryTable(h, rows) {
  const headers = [
    "Time",
    "Market",
    "Total Size",
    "Executed Size",
    "Average Price",
    "Total Runtime",
    "Trigger Price",
    "Max/Min Price",
    "Reduce Only",
    "Randomize",
    "Status",
  ];
  const body = (Array.isArray(rows) ? rows : []).slice(0, 80).map((rec) => {
    const st = twapStateOf(rec);
    const coin = st.coin || "—";
    const avg = twapAvgPx(st);
    const trig = twapTriggerPx(st);
    const execSz = st.executedSz;
    const hasExec = num(execSz) > 0;
    return h(
      "tr",
      null,
      h(
        "td",
        { class: "px-2 py-1.5 text-mist-400 whitespace-nowrap" },
        formatFillTime(twapCreationMs(st, rec))
      ),
      h("td", { class: "px-2 py-1.5 text-accent font-medium" }, coin),
      h("td", { class: "px-2 py-1.5 font-mono text-accent" }, twapSizeLabel(st.sz, st.coin)),
      h(
        "td",
        { class: "px-2 py-1.5 font-mono" + (hasExec ? " text-accent" : " text-mist-400") },
        hasExec ? twapSizeLabel(execSz, st.coin) : "—"
      ),
      h("td", { class: "px-2 py-1.5 font-mono" }, avg != null ? formatTwapPx(avg) : "—"),
      h("td", { class: "px-2 py-1.5 font-mono whitespace-nowrap" }, twapHistoryRuntimeLabel(rec)),
      h("td", { class: "px-2 py-1.5 font-mono text-mist-400" }, trig != null ? formatTwapPx(trig) : "—"),
      h("td", { class: "px-2 py-1.5 font-mono text-mist-400" }, twapMaxMinLabel(st)),
      h("td", { class: "px-2 py-1.5" }, twapYesNo(!!st.reduceOnly)),
      h("td", { class: "px-2 py-1.5" }, twapYesNo(!!st.randomize)),
      h("td", { class: "px-2 py-1.5" }, twapStatusLabel(rec))
    );
  });
  return h(
    "div",
    { class: "overflow-x-auto" },
    h(
      "table",
      { class: "bal-table" },
      h("thead", null, h("tr", null, ...headers.map((label) => h("th", null, label)))),
      h("tbody", null, ...body)
    )
  );
}

/**
 * Fill History — same columns as Trade History; pass unwrapped fills.
 * @param {typeof import("./dom.js").h} h
 */
export function buildTwapFillHistoryTable(h, fills, opts = {}) {
  return buildTradeHistoryTable(h, fills, opts);
}
