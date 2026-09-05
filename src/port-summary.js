import { balanceMarkPx, usdValue } from "./balances.js";
import { num } from "./format.js";

export const PORT_PERIODS = [
  { id: "day", label: "24h" },
  { id: "week", label: "7D" },
  { id: "month", label: "30D" },
  { id: "allTime", label: "All-time" },
];

export const PORT_CHARTS = [
  { id: "account", label: "Account Value" },
  { id: "pnl", label: "PNL" },
  { id: "perpPnl", label: "Perps PNL" },
];

export const PORT_ACCOUNTS = [
  { id: "perps", label: "Only Perps" },
  { id: "all", label: "All" },
];

const PERP_PERIOD = {
  day: "perpDay",
  week: "perpWeek",
  month: "perpMonth",
  allTime: "perpAllTime",
};

export function perpPeriodId(periodId) {
  return PERP_PERIOD[periodId] || "perpWeek";
}

export function windowId(periodId, accountMode) {
  return accountMode === "perps" ? perpPeriodId(periodId) : periodId;
}

/** Map Info `portfolio` tuples to a dict. Unknown shapes return {}. */
export function parsePortfolio(raw) {
  const out = {};
  if (!Array.isArray(raw)) return out;
  raw.forEach((row) => {
    if (!Array.isArray(row) || row.length < 2) return;
    const key = String(row[0] || "");
    const val = row[1];
    if (!key || !val || typeof val !== "object") return;
    out[key] = {
      accountValueHistory: Array.isArray(val.accountValueHistory) ? val.accountValueHistory : [],
      pnlHistory: Array.isArray(val.pnlHistory) ? val.pnlHistory : [],
      vlm: val.vlm,
    };
  });
  return out;
}

export function periodBlock(portfolio, periodId) {
  const p = portfolio && portfolio[periodId];
  return p || null;
}

/** Last numeric pnl in the series; null if missing (never invent). */
export function lastPnl(block) {
  const hist = block && block.pnlHistory;
  if (!Array.isArray(hist) || !hist.length) return null;
  for (let i = hist.length - 1; i >= 0; i--) {
    const pt = hist[i];
    const v = Array.isArray(pt) ? num(pt[1]) : num(pt && pt[1]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

export function periodVolume(block) {
  if (!block) return null;
  const v = num(block.vlm);
  return Number.isFinite(v) ? v : null;
}

export function pnlSeries(block) {
  return historyPairs(block, "pnlHistory");
}

export function historyPairs(block, field) {
  const hist = block && block[field];
  if (!Array.isArray(hist)) return [];
  const out = [];
  hist.forEach((pt) => {
    if (!Array.isArray(pt) || pt.length < 2) return;
    const t = num(pt[0]);
    const v = num(pt[1]);
    if (!Number.isFinite(t) || !Number.isFinite(v)) return;
    out.push({ t, v });
  });
  return out;
}

/**
 * Live series for the portfolio chart. Empty array if that window has no history.
 * Never invents points. `accountMode === "perps"` reads the perp* windows.
 */
export function chartSeries(portfolio, periodId, chartId, accountMode) {
  const perpsOnly = accountMode === "perps";
  if (chartId === "perpPnl" || (perpsOnly && chartId === "pnl")) {
    return historyPairs(periodBlock(portfolio, perpPeriodId(periodId)), "pnlHistory");
  }
  if (chartId === "account") {
    const key = perpsOnly ? perpPeriodId(periodId) : periodId;
    return historyPairs(periodBlock(portfolio, key), "accountValueHistory");
  }
  return historyPairs(periodBlock(portfolio, periodId), "pnlHistory");
}

export function summaryBlock(portfolio, periodId, accountMode) {
  return periodBlock(portfolio, windowId(periodId, accountMode));
}

export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    if (lo === 0) return [0];
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  const gaps = Math.max(2, count - 1);
  const raw = span / gaps;
  const exp = Math.floor(Math.log10(raw));
  const mag = Math.pow(10, exp);
  const steps = [];
  [0.5, 1, 2, 5, 10].forEach((n) => {
    const s = n * mag;
    if (s > 0) steps.push(s);
  });
  if (exp >= 1) steps.push(Math.pow(10, exp - 1) * 5);
  let best = null;
  steps.forEach((step) => {
    const start = Math.floor(lo / step) * step;
    const end = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step * 0.5; v += step) {
      ticks.push(Number(v.toPrecision(8)));
    }
    if (ticks.length < 3 || ticks.length > 7) return;
    const overshoot = end - hi + (lo - start);
    const score = Math.abs(ticks.length - count) * span + overshoot;
    if (!best || score < best.score) best = { ticks, score };
  });
  if (best) {
    const ticks = best.ticks.slice();
    if (lo < 0 && hi > 0 && ticks.every((t) => t !== 0)) {
      ticks.push(0);
      ticks.sort((a, b) => a - b);
    }
    return ticks;
  }
  const ticks = [];
  for (let i = 0; i <= gaps; i++) {
    ticks.push(Number((lo + (span * i) / gaps).toPrecision(8)));
  }
  return ticks;
}

/** Y ticks from this series only. Empty series → no ticks (never reuse another tab). */
export function axisTicks(points, count = 4) {
  if (!Array.isArray(points) || !points.length) return [];
  const ys = [];
  points.forEach((p) => {
    if (p && Number.isFinite(p.v)) ys.push(p.v);
  });
  if (!ys.length) return [];
  let min = Math.min.apply(null, ys);
  let max = Math.max.apply(null, ys);
  if (min > 0 && max > 0 && min / max < 0.15) min = 0;
  if (min < 0 && max < 0 && max / min < 0.15) max = 0;
  return niceTicks(min, max, count);
}

export function chartTickUsd(raw) {
  const n = num(raw);
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(1) + "k";
  if (abs === 0) return "0";
  if (abs >= 1) return sign + abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return sign + abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatChartDate(ms, spanMs) {
  const t = num(ms);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  if (Number.isFinite(spanMs) && spanMs > 0 && spanMs < 2 * 24 * 60 * 60 * 1000) {
    return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const mon = d.toLocaleString("en-US", { month: "short" });
  if (Number.isFinite(spanMs) && spanMs > 150 * 24 * 60 * 60 * 1000) {
    return mon + " " + d.getFullYear();
  }
  return mon + " " + d.getDate();
}

const SCRUB_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC calendar date for the scrubber tooltip, e.g. `2026 Mar 11`. */
export function formatScrubberDate(ms) {
  const t = num(ms);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  return d.getUTCFullYear() + " " + SCRUB_MON[d.getUTCMonth()] + " " + d.getUTCDate();
}

/** `$137` when whole dollars; keeps cents for non-integers. Never invents a value. */
export function formatScrubberUsd(raw) {
  const n = num(raw);
  if (!Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100);
  if (cents % 100 === 0 && (abs >= 1 || cents === 0)) {
    return sign + "$" + Math.round(abs).toLocaleString("en-US");
  }
  if (abs >= 1) {
    return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** `2026 Mar 11: $137` from a real history sample. */
export function formatScrubberTip(ms, value) {
  const date = formatScrubberDate(ms);
  const usd = formatScrubberUsd(value);
  if (!date || !usd) return "";
  return date + ": " + usd;
}

export const PORT_CHART_PAD = { l: 46, r: 36, t: 10, b: 22 };

export function portChartLayout(cssW, cssH, pts) {
  const w = Math.max(1, Number(cssW) || 1);
  const h = Math.max(1, Number(cssH) || 1);
  const pad = PORT_CHART_PAD;
  const plotW = Math.max(1, w - pad.l - pad.r);
  const plotH = Math.max(1, h - pad.t - pad.b);
  const rows = Array.isArray(pts) ? pts.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)) : [];
  const t0 = rows.length ? rows[0].t : 0;
  const t1 = rows.length ? rows[rows.length - 1].t : 0;
  const tSpan = t1 - t0;
  return { cssW: w, cssH: h, padL: pad.l, padR: pad.r, padT: pad.t, padB: pad.b, plotW, plotH, t0, t1, tSpan };
}

export function chartXOf(layout, t) {
  if (!layout) return 0;
  return layout.padL + (layout.tSpan === 0 ? layout.plotW / 2 : ((t - layout.t0) / layout.tSpan) * layout.plotW);
}

/** Nearest real sample to a canvas X. Empty series → null (never invent). */
export function snapChartPointByX(pts, layout, x) {
  const rows = Array.isArray(pts) ? pts.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)) : [];
  if (!rows.length || !layout) return null;
  const px = Number(x);
  if (!Number.isFinite(px)) return null;
  let best = rows[0];
  let bestD = Math.abs(chartXOf(layout, best.t) - px);
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(chartXOf(layout, rows[i].t) - px);
    if (d < bestD) {
      bestD = d;
      best = rows[i];
    }
  }
  return best;
}

/** Nearest real sample to a timestamp. Empty series → null. */
export function snapChartPointByT(pts, t) {
  const rows = Array.isArray(pts) ? pts.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)) : [];
  if (!rows.length) return null;
  const ts = num(t);
  if (!Number.isFinite(ts)) return null;
  let best = rows[0];
  let bestD = Math.abs(best.t - ts);
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i].t - ts);
    if (d < bestD) {
      bestD = d;
      best = rows[i];
    }
  }
  return best;
}

/**
 * Sum the user's own taker+maker notional over the last 14 dailyUserVlm rows.
 * Ignores `exchange` (venue-wide). Returns null when the feed is missing.
 */
export function sum14DayVolume(dailyUserVlm) {
  if (!Array.isArray(dailyUserVlm) || !dailyUserVlm.length) return null;
  const rows = dailyUserVlm.slice(-14);
  let sum = 0;
  let any = false;
  rows.forEach((d) => {
    if (!d) return;
    const cross = num(d.userCross);
    const add = num(d.userAdd);
    if (Number.isFinite(cross)) {
      sum += cross;
      any = true;
    }
    if (Number.isFinite(add)) {
      sum += add;
      any = true;
    }
  });
  return any ? sum : null;
}

export function sumVaultEquity(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let sum = 0;
  let any = false;
  rows.forEach((r) => {
    if (!r || typeof r !== "object") return;
    const v = num(r.equity != null ? r.equity : r.vaultEquity);
    if (!Number.isFinite(v)) return;
    sum += v;
    any = true;
  });
  return any ? sum : null;
}

export function spotEquityUsd(spotBalances, mids, markets) {
  if (!spotBalances) return null;
  let sum = 0;
  let any = false;
  (spotBalances || []).forEach((b) => {
    if (!b) return;
    const sz = num(b.total);
    if (!Number.isFinite(sz)) return;
    const px = balanceMarkPx(b.coin, mids, markets);
    const value = usdValue(sz, px);
    if (!Number.isFinite(value)) return;
    sum += value;
    any = true;
  });
  return any ? sum : null;
}

export function perpsEquity(perps) {
  const v = num(perps && perps.marginSummary && perps.marginSummary.accountValue);
  return Number.isFinite(v) ? v : null;
}

export function upnlSum(perps) {
  const positions = (perps && perps.assetPositions) || [];
  let sum = 0;
  let any = false;
  positions.forEach((ap) => {
    const p = ap && ap.position;
    if (!p) return;
    const n = num(p.unrealizedPnl);
    if (!Number.isFinite(n)) return;
    sum += n;
    any = true;
  });
  return any ? sum : null;
}

export function stakingUsd(summary, hypePx) {
  const amt = num(summary && summary.delegated);
  if (!Number.isFinite(amt)) return null;
  const px = num(hypePx);
  if (!Number.isFinite(px) || px <= 0) return null;
  return amt * px;
}

/** Live Info `subAccounts` rows. Unknown shapes return []. */
export function parseSubAccounts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const addr = String(row.subAccountUser || "");
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return;
    const name = String(row.name || "").trim();
    out.push({ address: addr, name });
  });
  return out;
}

export function missingMoney() {
  return "--";
}
