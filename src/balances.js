import { DUST } from "./api.js";
import { num } from "./format.js";

export const SMALL_BAL_USD = 1;

/** Info `userAbstraction` returns a camelCase mode string (sometimes extra-quoted). */
export function normalizeAbstraction(raw) {
  if (raw == null || raw === "") return "";
  let s = raw;
  if (typeof s === "object") {
    s = s.abstractionMode || s.mode || s.state || s.type || "";
  }
  return String(s)
    .trim()
    .replace(/^"+|"+$/g, "");
}

/**
 * Unified account and portfolio margin keep trading balances in spotClearinghouseState.
 * Standard / disabled / DEX-abstraction keep using perps clearinghouse withdrawable.
 * When the mode is unknown, infer unified if perps withdrawable is near dust while spot holds USDC.
 */
export function usesSpotTradingBalance(abstraction, perps, spotBalances) {
  const mode = normalizeAbstraction(abstraction).toLowerCase();
  if (mode === "unifiedaccount" || mode === "portfoliomargin") return true;
  if (mode === "disabled" || mode === "dexabstraction") return false;
  const wd = num(perps && perps.withdrawable);
  const spotAvail = spotUsdcParts(spotBalances).available;
  if (!(Number.isFinite(spotAvail) && spotAvail > 1)) return false;
  if (!Number.isFinite(wd) || wd <= 0) return true;
  return Math.abs(wd) < 1 || Math.abs(wd) * 10 < spotAvail;
}

export function spotUsdcParts(balances) {
  let total = 0;
  let hold = 0;
  (balances || []).forEach((b) => {
    if (!b || String(b.coin).toUpperCase() !== "USDC") return;
    const t = num(b.total);
    const ho = num(b.hold);
    if (Number.isFinite(t)) total += t;
    if (Number.isFinite(ho)) hold += ho;
  });
  return { total, available: Math.max(0, total - hold) };
}

/** Perps ticket collateral in USDC — not multiplied by leverage. */
export function perpsAvailableCollateral({ abstraction, perps, spotBalances } = {}) {
  if (usesSpotTradingBalance(abstraction, perps, spotBalances)) {
    const n = spotUsdcParts(spotBalances).available;
    return Number.isFinite(n) ? n : NaN;
  }
  const wd = num(perps && perps.withdrawable);
  return Number.isFinite(wd) ? wd : NaN;
}

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

function isRawTokenId(coin) {
  const s = String(coin || "").trim();
  const ch = s.charAt(0);
  return ch === "+" || ch === "#" || ch === "@" || /^\d+$/.test(s);
}

function outcomeEncoding(coin) {
  const s = String(coin || "").trim();
  const body = /^[+#@]/.test(s) ? s.slice(1) : /^\d+$/.test(s) ? s : "";
  if (!body) return null;
  const enc = Number(body);
  if (!Number.isInteger(enc) || enc < 0) return null;
  return { enc, outcomeId: Math.floor(enc / 10), side: enc % 10 };
}

function marketForBalanceCoin(coin, markets) {
  const c = String(coin || "");
  if (!c) return null;
  const hash = c.charAt(0) === "+" ? "#" + c.slice(1) : c;
  const plus = c.charAt(0) === "#" ? "+" + c.slice(1) : c;
  const parsed = outcomeEncoding(c);
  const list = markets || [];
  let byId = null;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (!x) continue;
    if (
      x.coin === c ||
      x.coin === hash ||
      x.noCoin === c ||
      x.noCoin === hash ||
      x.balanceCoin === c ||
      x.balanceCoin === plus ||
      x.noBalanceCoin === c ||
      x.noBalanceCoin === plus
    ) {
      return x;
    }
    if (parsed && x.kind === "outcome" && Number(x.outcomeId) === parsed.outcomeId) {
      byId = byId || x;
    }
  }
  return byId;
}

function outcomeSideLabel(coin) {
  const parsed = outcomeEncoding(coin);
  if (!parsed) return "Outcome";
  return parsed.side === 1 ? "Outcome · No" : "Outcome · Yes";
}

/** Never show bare `+14090` / `#14090` as the Asset name. */
export function balanceAssetLabel(coin, markets) {
  const c = String(coin || "").trim();
  if (!c) return "";
  if (c.toUpperCase() === "USDC") return "USDC";
  const m = marketForBalanceCoin(c, markets);
  if (m) {
    const title = m.pair || m.description || "";
    if (m.kind === "outcome") {
      const parsed = outcomeEncoding(c);
      const side = parsed && parsed.side === 1 ? "No" : "Yes";
      if (title && !isRawTokenId(title)) return title + " · " + side;
      return "Outcome · " + side;
    }
    if (title && !isRawTokenId(title)) return title;
    if (m.base && !isRawTokenId(m.base)) return m.base;
  }
  if (isRawTokenId(c)) return outcomeSideLabel(c);
  return c;
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
 * Live rows from spotClearinghouseState + optional perps USDC fallback.
 * At most one USDC row: spot USDC wins; perps clearinghouse USDC only if spot has none.
 * hideSmall drops known USD values under $1; unknown values stay visible.
 */
export function buildBalanceRows({ perps, spotBalances, mids, markets, hideSmall, abstraction }) {
  const others = [];
  let usdcTotal = 0;
  let usdcAvail = 0;
  let usdcSeen = false;
  (spotBalances || []).forEach((b) => {
    if (!b || b.coin == null || b.coin === "") return;
    const total = num(b.total);
    if (!Number.isFinite(total) || Math.abs(total) < DUST) return;
    if (String(b.coin).toUpperCase() === "USDC") {
      usdcSeen = true;
      usdcTotal += total;
      const avail = availableBalance(b.total, b.hold);
      if (Number.isFinite(avail)) usdcAvail += avail;
      return;
    }
    const px = balanceMarkPx(b.coin, mids, markets);
    const value = usdValue(total, px);
    const m = marketForBalanceCoin(b.coin, markets);
    others.push({
      coin: b.coin,
      label: balanceAssetLabel(b.coin, markets),
      iconCoin: (m && m.underlying) || iconCoinFromBalance(b.coin),
      total,
      available: availableBalance(b.total, b.hold),
      value,
      pnlPct: pnlPctFromEntry(b.entryNtl, value),
    });
  });

  const rows = [];
  // Hard rule: at most one USDC row. Spot USDC always wins over perps accountValue.
  if (usdcSeen) {
    rows.push({
      coin: "USDC",
      label: "USDC",
      iconCoin: "USDC",
      total: usdcTotal,
      available: usdcAvail,
      value: usdcTotal,
      pnlPct: null,
    });
  } else {
    const ms = (perps && perps.marginSummary) || {};
    const acct = num(ms.accountValue);
    const wd = num(perps && perps.withdrawable);
    if ((Number.isFinite(acct) && Math.abs(acct) >= DUST) || (Number.isFinite(wd) && Math.abs(wd) >= DUST)) {
      const total = Number.isFinite(acct) ? acct : 0;
      rows.push({
        coin: "USDC",
        label: "USDC",
        iconCoin: "USDC",
        total,
        available: Number.isFinite(wd) ? wd : 0,
        value: total,
        pnlPct: null,
      });
    }
  }
  rows.push(...others);
  if (!hideSmall) return rows;
  return rows.filter((r) => !Number.isFinite(r.value) || Math.abs(r.value) >= SMALL_BAL_USD);
}
