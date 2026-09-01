import { balanceMarkPx, usdValue } from "./balances.js";
import { num } from "./format.js";

export const PORT_PERIODS = [
  { id: "week", label: "7 Days" },
  { id: "month", label: "30 Days" },
  { id: "allTime", label: "All Time" },
];

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
  const hist = block && block.pnlHistory;
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
