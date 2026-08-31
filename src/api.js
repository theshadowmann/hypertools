import { HL_INFO, HL_EXCHANGE, HL_WS } from "./hosts.js";
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
    },
    errors,
  };
}

export async function loadMarkets() {
  const payload = await hlInfo({ type: "metaAndAssetCtxs" });
  const meta = payload && payload[0];
  const ctxs = payload && payload[1];
  const universe = (meta && meta.universe) || [];
  const markets = [];
  universe.forEach((u, i) => {
    if (!u || u.isDelisted) return;
    const ctx = (ctxs && ctxs[i]) || {};
    markets.push({
      coin: u.name,
      asset: i,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      onlyIsolated: !!u.onlyIsolated,
      markPx: ctx.markPx,
      midPx: ctx.midPx,
      oraclePx: ctx.oraclePx,
      funding: ctx.funding,
      openInterest: ctx.openInterest,
      dayNtlVlm: ctx.dayNtlVlm,
      prevDayPx: ctx.prevDayPx,
    });
  });
  markets.sort((a, b) => Number(b.dayNtlVlm || 0) - Number(a.dayNtlVlm || 0));
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

export function bookLevels(snapshot) {
  const levels = snapshot && snapshot.levels;
  const bids = (levels && levels[0]) || [];
  const asks = (levels && levels[1]) || [];
  return { bids, asks, time: snapshot && snapshot.time };
}
