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
  const raw = span / Math.max(1, count - 1);
  const exp = Math.floor(Math.log10(raw));
  const mag = Math.pow(10, exp);
  const f = raw / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  const step = nf * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 0.5; v += step) {
    const n = Number(v.toPrecision(8));
    ticks.push(n);
  }
  return ticks;
}

export function chartTickUsd(raw) {
  const n = num(raw);
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(1) + "k";
  if (abs >= 1) return sign + "$" + abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs === 0) return "$0";
  return sign + "$" + abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
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

export function missingMoney() {
  return "--";
}
