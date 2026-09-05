import { HL_INFO, HL_EXCHANGE, HL_WS } from "./hosts.js";
import { mergeMarkets, parsePerpMarkets, parseSpotMarkets } from "./markets.js";
import { enrichOutcomeMarkets, fetchSpotAssetCtxs } from "./outcome-ctxs.js";
import { parseOutcomeMarkets } from "./outcomes.js";
export { HL_INFO, HL_EXCHANGE, HL_WS };
export const DUST = 1e-8;
export const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export function hlInfo(body) {
  return fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) {
      throw new Error("HTTP " + res.status + " from Hyperliquid Info API");
    }
    return res.json();
  });
}

function settledValue(result, label, errors) {
  if (result.status === "fulfilled") return result.value;
  const msg = (result.reason && result.reason.message) || String(result.reason);
  errors.push(label + ": " + msg);
  return null;
}

export async function loadAccount(address) {
  const results = await Promise.allSettled([
    hlInfo({ type: "clearinghouseState", user: address }),
    hlInfo({ type: "spotClearinghouseState", user: address }),
    hlInfo({ type: "delegatorSummary", user: address }),
    hlInfo({ type: "delegations", user: address }),
    hlInfo({ type: "allMids" }),
    hlInfo({ type: "validatorSummaries" }),
    hlInfo({ type: "frontendOpenOrders", user: address }),
    hlInfo({ type: "userFills", user: address }),
    hlInfo({ type: "portfolio", user: address }),
    hlInfo({ type: "userFees", user: address }),
    hlInfo({ type: "userVaultEquities", user: address }),
    hlInfo({ type: "leadingVaults", user: address }),
    hlInfo({ type: "subAccounts", user: address }),
    hlInfo({ type: "userAbstraction", user: address }),
  ]);

  const errors = [];
  const perps = settledValue(results[0], "clearinghouseState", errors);
  const spot = settledValue(results[1], "spotClearinghouseState", errors);
  const staking = settledValue(results[2], "delegatorSummary", errors);
  const dels = settledValue(results[3], "delegations", errors);
  const mids = settledValue(results[4], "allMids", errors);
  const validators = settledValue(results[5], "validatorSummaries", errors);
  const openOrders = settledValue(results[6], "frontendOpenOrders", errors);
  const fills = settledValue(results[7], "userFills", errors);
  const portfolio = settledValue(results[8], "portfolio", errors);
  const userFees = settledValue(results[9], "userFees", errors);
  const userVaultEquities = settledValue(results[10], "userVaultEquities", errors);
  const leadingVaults = settledValue(results[11], "leadingVaults", errors);
  const subAccounts = settledValue(results[12], "subAccounts", errors);
  const abstraction = results[13] && results[13].status === "fulfilled" ? results[13].value : null;

  const validatorNames = {};
  if (Array.isArray(validators)) {
    validators.forEach((v) => {
      if (!v || !v.validator) return;
      const key = String(v.validator).toLowerCase();
      validatorNames[key] = v.name || v.validator;
    });
  }

  return {
    data: {
      perps,
      spot,
      staking,
      delegations: Array.isArray(dels) ? dels : dels == null ? null : [],
      mids: mids && typeof mids === "object" ? mids : {},
      validatorNames,
      openOrders: Array.isArray(openOrders) ? openOrders : [],
      fills: Array.isArray(fills) ? fills : [],
      portfolio,
      userFees: userFees && typeof userFees === "object" ? userFees : null,
      userVaultEquities: Array.isArray(userVaultEquities) ? userVaultEquities : [],
      leadingVaults: Array.isArray(leadingVaults) ? leadingVaults : [],
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
  const results = await Promise.allSettled([
    hlInfo({ type: "metaAndAssetCtxs" }),
    hlInfo({ type: "spotMetaAndAssetCtxs" }),
    hlInfo({ type: "outcomeMeta" }),
    hlInfo({ type: "allMids" }),
    hlInfo({ type: "metaAndAssetCtxs", dex: "xyz" }),
    hlInfo({ type: "outcomeTemplates" }),
  ]);
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

export function candleSnapshotBody(coin, interval) {
  const range = candleRange(interval);
  return {
    type: "candleSnapshot",
    req: {
      coin: String(coin || ""),
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
  const c = String(coin || "");
  if (!c) return [];
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
  const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const results = await Promise.allSettled([
    hlInfo({ type: "historicalOrders", user: address }),
    hlInfo({ type: "userFunding", user: address, startTime }),
    hlInfo({ type: "twapHistory", user: address }),
    hlInfo({ type: "userFees", user: address }),
    hlInfo({ type: "userTwapSliceFills", user: address }),
  ]);
  function val(i) {
    return results[i].status === "fulfilled" ? results[i].value : null;
  }
  return {
    historicalOrders: Array.isArray(val(0)) ? val(0) : [],
    fundingHistory: Array.isArray(val(1)) ? val(1) : [],
    twapHistory: Array.isArray(val(2)) ? val(2) : [],
    twapFills: Array.isArray(val(4)) ? val(4) : [],
    userFees: val(3) && typeof val(3) === "object" ? val(3) : null,
  };
}

export function bookLevels(snapshot) {
  const levels = snapshot && snapshot.levels;
  const bids = (levels && levels[0]) || [];
  const asks = (levels && levels[1]) || [];
  return { bids, asks, time: snapshot && snapshot.time };
}
