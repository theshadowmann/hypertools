import { HL_INFO, HL_EXCHANGE, HL_WS } from "./hosts.js";
import { mergeMarkets, parsePerpMarkets, parseSpotMarkets } from "./markets.js";
import { enrichOutcomeMarkets, fetchSpotAssetCtxs } from "./outcome-ctxs.js";
import { parseOutcomeMarkets } from "./outcomes.js";
export { HL_INFO, HL_EXCHANGE, HL_WS };
export const DUST = 1e-8;
export const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Max concurrent Info POSTs. HL 429s when the page fans out 10–20 at once. */
const INFO_MAX_INFLIGHT = 2;
let infoInflight = 0;
const infoWaiters = [];
let infoPaused = false;

export function pauseHlInfo(ms = 8000) {
  infoPaused = true;
  setTimeout(() => {
    infoPaused = false;
    pumpInfoQueue();
  }, ms);
}

function pumpInfoQueue() {
  while (!infoPaused && infoInflight < INFO_MAX_INFLIGHT && infoWaiters.length) {
    const next = infoWaiters.shift();
    infoInflight += 1;
    next();
  }
}

function enqueueInfo(run) {
  return new Promise((resolve, reject) => {
    const start = () => {
      Promise.resolve()
        .then(run)
        .then(resolve, reject)
        .finally(() => {
          infoInflight -= 1;
          pumpInfoQueue();
        });
    };
    infoWaiters.push(start);
    pumpInfoQueue();
  });
}

async function hlInfoOnce(body, attempt = 0) {
  while (infoPaused) await sleep(200);
  const res = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 4) {
    await sleep(2500 * (attempt + 1));
    return hlInfoOnce(body, attempt + 1);
  }
  if (!res.ok) {
    throw new Error("HTTP " + res.status + " from Hyperliquid Info API");
  }
  return res.json();
}

/** Queued Info POST with backoff on HTTP 429. */
export function hlInfo(body) {
  return enqueueInfo(() => hlInfoOnce(body));
}

function settledValue(result, label, errors) {
  if (result.status === "fulfilled") return result.value;
  const msg = (result.reason && result.reason.message) || String(result.reason);
  errors.push(label + ": " + msg);
  return null;
}

/**
 * Trade/portfolio hot path. Keep this small — a 14-way Info burst trips HL 429s
 * and then balances + Enable trading both fail for the same reason.
 */
export async function loadAccount(address) {
  const errors = [];
  // Two at a time (queue also caps). Balances first so Available to Trade fills.
  const bal = await Promise.allSettled([
    hlInfo({ type: "clearinghouseState", user: address }),
    hlInfo({ type: "spotClearinghouseState", user: address }),
  ]);
  const perps = settledValue(bal[0], "clearinghouseState", errors);
  const spot = settledValue(bal[1], "spotClearinghouseState", errors);

  const midAbs = await Promise.allSettled([
    hlInfo({ type: "userAbstraction", user: address }),
    hlInfo({ type: "allMids" }),
  ]);
  const abstraction = midAbs[0].status === "fulfilled" ? midAbs[0].value : null;
  const mids = settledValue(midAbs[1], "allMids", errors);

  const book = await Promise.allSettled([
    hlInfo({ type: "frontendOpenOrders", user: address }),
    hlInfo({ type: "userFills", user: address }),
  ]);
  const openOrders = settledValue(book[0], "frontendOpenOrders", errors);
  const fills = settledValue(book[1], "userFills", errors);

  // Portfolio chrome last — skip if we already tripped rate limits.
  let portfolio = null;
  let userFees = null;
  let staking = null;
  let dels = null;
  let subAccounts = [];
  if (!errors.some((e) => /429|Too Many/i.test(e))) {
    await sleep(400);
    const slow = await Promise.allSettled([
      hlInfo({ type: "portfolio", user: address }),
      hlInfo({ type: "userFees", user: address }),
    ]);
    portfolio = settledValue(slow[0], "portfolio", errors);
    userFees = settledValue(slow[1], "userFees", errors);
    await sleep(300);
    const slow2 = await Promise.allSettled([
      hlInfo({ type: "delegatorSummary", user: address }),
      hlInfo({ type: "delegations", user: address }),
      hlInfo({ type: "subAccounts", user: address }),
    ]);
    staking = settledValue(slow2[0], "delegatorSummary", errors);
    dels = settledValue(slow2[1], "delegations", errors);
    subAccounts = settledValue(slow2[2], "subAccounts", errors);
  }

  return {
    data: {
      perps,
      spot,
      staking,
      delegations: Array.isArray(dels) ? dels : dels == null ? null : [],
      mids: mids && typeof mids === "object" ? mids : {},
      validatorNames: {},
      openOrders: Array.isArray(openOrders) ? openOrders : [],
      fills: Array.isArray(fills) ? fills : [],
      portfolio,
      userFees: userFees && typeof userFees === "object" ? userFees : null,
      userVaultEquities: [],
      leadingVaults: [],
      subAccounts: Array.isArray(subAccounts) ? subAccounts : [],
      abstraction,
    },
    errors,
  };
}

function marksFromMetaCtxs(payload) {
  const out = {};
  if (!Array.isArray(payload) || !payload[0] || !Array.isArray(payload[1])) return out;
  const uni = payload[0].universe || [];
  const ctxs = payload[1];
  uni.forEach((u, i) => {
    if (!u || !u.name || !ctxs[i] || ctxs[i].markPx == null) return;
    if (Number(ctxs[i].markPx) > 0) out[u.name] = ctxs[i].markPx;
  });
  return out;
}

export async function loadMarkets() {
  const spotCtxsP = fetchSpotAssetCtxs().catch(() => ({}));
  const batch1 = await Promise.allSettled([
    hlInfo({ type: "metaAndAssetCtxs" }),
    hlInfo({ type: "spotMetaAndAssetCtxs" }),
  ]);
  await sleep(250);
  const batch2 = await Promise.allSettled([
    hlInfo({ type: "outcomeMeta" }),
    hlInfo({ type: "allMids" }),
  ]);
  await sleep(250);
  const batch3 = await Promise.allSettled([
    hlInfo({ type: "metaAndAssetCtxs", dex: "xyz" }),
    hlInfo({ type: "outcomeTemplates" }),
  ]);
  const results = [...batch1, ...batch2, ...batch3];
  const perps = results[0].status === "fulfilled" ? parsePerpMarkets(results[0].value) : [];
  const spot = results[1].status === "fulfilled" ? parseSpotMarkets(results[1].value) : [];
  const outcomeMeta = results[2].status === "fulfilled" ? results[2].value : null;
  const mids = results[3].status === "fulfilled" ? results[3].value : {};
  const hip3Marks = marksFromMetaCtxs(results[4].status === "fulfilled" ? results[4].value : null);
  const templates = results[5].status === "fulfilled" ? results[5].value : null;
  const parsed = outcomeMeta ? parseOutcomeMarkets(outcomeMeta, mids, hip3Marks, templates) : [];
  const spotCtxs = await spotCtxsP;
  const outcomes = enrichOutcomeMarkets(parsed, spotCtxs);
  const markets = mergeMarkets(perps, spot, outcomes);
  if (!markets.length) throw new Error("Hyperliquid returned no markets");
  return markets;
}

export function candleRange(interval) {
  const now = Date.now();
  const ms = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
  }[interval] || 60_000;
  const startTime = now - ms * 320;
  return { startTime, endTime: now };
}

/**
 * Info API candle coin. HIP-4 `+` balances become `#` wire coins.
 * TradingView slugs are refused so we never POST a 500-body to HL.
 */
export function normalizeCandleCoin(coin) {
  const s = String(coin || "").trim();
  if (!s) return "";
  if (/^out:/i.test(s) || /^HYPERLIQUID:/i.test(s)) return "";
  if (s.charAt(0) === "+" && /^\d+$/.test(s.slice(1))) return "#" + s.slice(1);
  return s;
}

export function candleSnapshotBody(coin, interval) {
  const range = candleRange(interval);
  return {
    type: "candleSnapshot",
    req: {
      coin: normalizeCandleCoin(coin),
      interval: hlCandleInterval(interval),
      startTime: range.startTime,
      endTime: range.endTime,
    },
  };
}

export function hlCandleInterval(interval) {
  return (
    {
      "1m": "1m",
      "5m": "5m",
      "15m": "15m",
      "1h": "1h",
      "4h": "4h",
      "1d": "1d",
    }[interval] || "15m"
  );
}

export async function loadCandles(coin, interval) {
  const raw = String(coin || "").trim();
  const c = normalizeCandleCoin(raw);
  if (!c) {
    if (raw) throw new Error("Invalid candle coin");
    return [];
  }
  const rows = await hlInfo(candleSnapshotBody(c, interval));
  return candlesToBars(rows);
}

export function candlesToBars(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  const seen = new Set();
  rows.forEach((c) => {
    const t = Math.floor(Number(c.t) / 1000);
    if (!Number.isFinite(t) || seen.has(t)) return;
    const open = Number(c.o);
    const high = Number(c.h);
    const low = Number(c.l);
    const close = Number(c.c);
    if (![open, high, low, close].every(Number.isFinite)) return;
    seen.add(t);
    out.push({ time: t, open, high, low, close, volume: Number(c.v) || 0 });
  });
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Yesterday's close from daily bars: last bar's open, else prior close. Never invents. */
export function prevDayFromDailyBars(bars) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const last = bars[bars.length - 1];
  const open = Number(last && last.open);
  if (Number.isFinite(open) && open > 0) return open;
  if (bars.length >= 2) {
    const close = Number(bars[bars.length - 2].close);
    if (Number.isFinite(close) && close > 0) return close;
  }
  return null;
}

export function dailyPrevDayBody(coin) {
  const now = Date.now();
  return {
    type: "candleSnapshot",
    req: {
      coin: String(coin || ""),
      interval: "1d",
      startTime: now - 8 * 24 * 60 * 60 * 1000,
      endTime: now,
    },
  };
}

export async function loadDailyPrevDay(coin) {
  const c = String(coin || "");
  if (!c) return null;
  const rows = await hlInfo(dailyPrevDayBody(c));
  return prevDayFromDailyBars(candlesToBars(rows));
}

export async function loadTradeExtras(address) {
  // Sequential + small set — avoid stacking another 5-way burst on connect.
  const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const historicalOrders = await hlInfo({ type: "historicalOrders", user: address }).catch(() => []);
  await sleep(150);
  const fundingHistory = await hlInfo({ type: "userFunding", user: address, startTime }).catch(() => []);
  await sleep(150);
  const twapHistory = await hlInfo({ type: "twapHistory", user: address }).catch(() => []);
  return {
    historicalOrders: Array.isArray(historicalOrders) ? historicalOrders : [],
    fundingHistory: Array.isArray(fundingHistory) ? fundingHistory : [],
    twapHistory: Array.isArray(twapHistory) ? twapHistory : [],
    twapFills: [],
    userFees: null,
  };
}

export function bookLevels(snapshot) {
  const levels = snapshot && snapshot.levels;
  const bids = (levels && levels[0]) || [];
  const asks = (levels && levels[1]) || [];
  return { bids, asks, time: snapshot && snapshot.time };
}
