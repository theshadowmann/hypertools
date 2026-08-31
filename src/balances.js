import { DUST } from "./api.js";
import { num } from "./format.js";

export const SMALL_BAL_USD = 1;

export function availableBalance(total, hold) {
  const t = Number(total);
  const h = Number(hold);
  if (!Number.isFinite(t)) return NaN;
  if (!Number.isFinite(h)) return t;
  return t - h;
}

export function usdValue(size, px) {
  const s = Number(size);
  const p = Number(px);
  if (!Number.isFinite(s) || !Number.isFinite(p) || p <= 0) return NaN;
  return s * p;
}

/** Percent PNL from Hyperliquid entryNtl vs current USD value. null = unknown, never invent. */
export function pnlPctFromEntry(entryNtl, valueUsd) {
  const e = Number(entryNtl);
  const v = Number(valueUsd);
  if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(v)) return null;
  return ((v - e) / e) * 100;
}

export function iconCoinFromBalance(coin) {
  const c = String(coin || "").trim();
  if (!c) return "";
  const slash = c.indexOf("/");
  return slash > 0 ? c.slice(0, slash) : c;
}

export function balanceMarkPx(coin, mids, markets) {
  const c = String(coin || "");
  if (!c) return NaN;
  if (c.toUpperCase() === "USDC") return 1;
  const book = mids && typeof mids === "object" ? mids : {};
  const hash = c.charAt(0) === "+" ? "#" + c.slice(1) : c;
  const fromMid = num(book[c]) || num(book[hash]) || num(book[c + "/USDC"]);
  if (fromMid > 0) return fromMid;
  const list = markets || [];
  let m = list.find((x) => x && x.kind === "outcome" && (x.coin === c || x.coin === hash || x.noCoin === c || x.noCoin === hash || x.balanceCoin === c));
  if (m) {
    const enc = Number((c.charAt(0) === "#" || c.charAt(0) === "+" ? c.slice(1) : c));
    const side = Number.isInteger(enc) ? enc % 10 : 0;
    const px = side === 1 ? num(m.noMarkPx) : num(m.markPx);
    if (px > 0) return px;
  }
  m = list.find((x) => x && x.kind === "spot" && (x.base === c || x.coin === c));
  if (!m) m = list.find((x) => x && x.kind === "perp" && x.coin === c);
  if (!m) return NaN;
  const px = num(m.markPx) || num(m.oraclePx) || num(m.midPx);
  return px > 0 ? px : NaN;
}

export function formatPnlPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return (
    sign +
    pct.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    "%"
  );
}

/**
 * Live rows from spotClearinghouseState balances + clearinghouse USDC + mids.
 * hideSmall drops known USD values under $1; unknown values stay visible.
 */
export function buildBalanceRows({ perps, spotBalances, mids, markets, hideSmall }) {
  const rows = [];
  const ms = (perps && perps.marginSummary) || {};
  const acct = num(ms.accountValue);
  const wd = num(perps && perps.withdrawable);
  if ((Number.isFinite(acct) && Math.abs(acct) >= DUST) || (Number.isFinite(wd) && Math.abs(wd) >= DUST)) {
    const total = Number.isFinite(acct) ? acct : 0;
    rows.push({
      coin: "USDC",
      iconCoin: "USDC",
      total,
      available: Number.isFinite(wd) ? wd : 0,
      value: total,
      pnlPct: null,
    });
  }
  (spotBalances || []).forEach((b) => {
    if (!b || b.coin == null || b.coin === "") return;
    const total = num(b.total);
    if (!Number.isFinite(total) || Math.abs(total) < DUST) return;
    const px = balanceMarkPx(b.coin, mids, markets);
    const value = usdValue(total, px);
    rows.push({
      coin: b.coin,
      iconCoin: iconCoinFromBalance(b.coin),
      total,
      available: availableBalance(b.total, b.hold),
      value,
      pnlPct: pnlPctFromEntry(b.entryNtl, value),
    });
  });
  if (!hideSmall) return rows;
  return rows.filter((r) => !Number.isFinite(r.value) || Math.abs(r.value) >= SMALL_BAL_USD);
}
