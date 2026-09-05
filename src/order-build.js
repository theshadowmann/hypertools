/**
 * Hyperliquid order construction — kept free of wallet/SDK imports so unit tests
 * can assert builder attachment and rounding without a browser.
 *
 * Builder fee `f` is tenths of a basis point (docs: Exchange endpoint + Builder codes).
 *   1  = 0.1 bp = 0.001%
 *  10  = 1 bp  = 0.01%
 * 100  = 10 bp = 0.1%  (perp maximum)
 *
 * We charge 1 bp. approveBuilderFee maxFeeRate must be the matching percent string "0.01%".
 *
 * HIP-4 outcome orders use the same `order` action as perps. Differences:
 *   a  = 100_000_000 + 10 * outcomeId + side  (Yes=0, No=1)
 *   s  = integer share count (szDecimals 0)
 *   p  = probability in [0.001, 0.999], tick 0.0001
 *   t  = { limit: { tif: "Gtc" | "Ioc" } }  (same as perps)
 * Builder is still last-written by sealOrderPayload.
 */

import { OUTCOME_ASSET_OFFSET, roundOutcomePx } from "./outcomes.js";

/** Builder that receives the fee. Lowercase 0x as Hyperliquid expects. */
export const BUILDER_ADDRESS = "0x999a4b5f268a8fbf33736feff360d462ad248dbf";

/** Tenths of a basis point. 10 = 1 bp = 0.01% of notional. */
export const BUILDER_FEE_TENTHS = 10;

/** Percent string for approveBuilderFee; must cover BUILDER_FEE_TENTHS. */
export const BUILDER_MAX_FEE_RATE = "0.01%";

export const AGENT_NAME = "HyperTools";

const PERP_MAX_DECIMALS = 6;

export function hlAddress(addr) {
  return String(addr || "").trim().toLowerCase();
}

export function builderParam() {
  return { b: hlAddress(BUILDER_ADDRESS), f: BUILDER_FEE_TENTHS };
}

export function significantRound(value, sig = 5) {
  if (!Number.isFinite(value) || value === 0) return 0;
  const abs = Math.abs(value);
  const exp = Math.floor(Math.log10(abs));
  const factor = Math.pow(10, sig - 1 - exp);
  return Math.round(value * factor) / factor;
}

export function roundPx(px, szDecimals) {
  const decimals = Math.max(0, PERP_MAX_DECIMALS - Number(szDecimals || 0));
  const sig = significantRound(px, 5);
  const factor = Math.pow(10, decimals);
  return Math.round(sig * factor) / factor;
}

export function roundSz(sz, szDecimals) {
  const d = Math.max(0, Number(szDecimals || 0));
  const factor = Math.pow(10, d);
  return Math.round(sz * factor) / factor;
}

export function toWire(n) {
  if (!Number.isFinite(n)) throw new Error("Invalid numeric value");
  let s = n.toFixed(8);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (s === "-0") s = "0";
  return s;
}

export function slippagePrice(mid, isBuy, slippage = 0.05) {
  const px = Number(mid);
  if (!Number.isFinite(px) || px <= 0) throw new Error("No mid price for this market");
  return isBuy ? px * (1 + slippage) : px * (1 - slippage);
}

/**
 * Build a single order object for the Hyperliquid `order` action.
 * Limit uses Gtc / Ioc / Alo. Market is an aggressive Ioc (Hyperliquid has no native market type).
 */
export function buildOrderWire({
  asset,
  isBuy,
  size,
  price,
  reduceOnly = false,
  type = "limit",
  tif = "Gtc",
  szDecimals = 5,
  triggerPx,
  tpsl = "sl",
  triggerIsMarket = true,
}) {
  const a = Number(asset);
  if (!Number.isInteger(a) || a < 0) throw new Error("Unknown market");
  const outcome = a >= OUTCOME_ASSET_OFFSET;
  const szDec = outcome ? 0 : szDecimals;
  const szNum = roundSz(Number(size), szDec);
  if (!Number.isFinite(szNum) || szNum <= 0) throw new Error("Enter a size greater than zero");

  function pxFor(raw) {
    return outcome ? roundOutcomePx(raw) : roundPx(Number(raw), szDec);
  }

  let t;
  let pxNum;
  if (type === "stop") {
    const trig = pxFor(triggerPx);
    if (!Number.isFinite(trig) || trig <= 0) throw new Error("Enter a trigger price");
    pxNum = triggerIsMarket ? pxFor(slippagePrice(trig, isBuy, 0.08)) : pxFor(price);
    if (!Number.isFinite(pxNum) || pxNum <= 0) throw new Error("Enter a limit price for this stop");
    t = {
      trigger: {
        isMarket: !!triggerIsMarket,
        triggerPx: toWire(trig),
        tpsl: tpsl === "tp" ? "tp" : "sl",
      },
    };
  } else if (type === "market") {
    pxNum = pxFor(price);
    if (!Number.isFinite(pxNum) || pxNum <= 0) throw new Error("No price for market order");
    t = { limit: { tif: "Ioc" } };
  } else {
    const rawPx = Number(price);
    if (!Number.isFinite(rawPx) || rawPx <= 0) throw new Error("Enter a limit price");
    pxNum = pxFor(price);
    if (!Number.isFinite(pxNum) || pxNum <= 0) throw new Error("Enter a limit price");
    const allowed = { Gtc: "Gtc", Ioc: "Ioc", Alo: "Alo" };
    t = { limit: { tif: allowed[tif] || "Gtc" } };
  }

  return {
    a,
    b: !!isBuy,
    p: toWire(pxNum),
    s: toWire(szNum),
    r: !!reduceOnly,
    t,
  };
}

export function buildOrderPayload(orders, grouping = "na") {
  const list = Array.isArray(orders) ? orders : [orders];
  return sealOrderPayload({
    orders: list,
    grouping,
  });
}

/**
 * Last-write of builder before send. UI, query strings, and mutated payloads
 * cannot keep a different `b` / `f`.
 */
export function sealOrderPayload(payload) {
  const orders = payload && Array.isArray(payload.orders) ? payload.orders : [];
  const grouping = payload && typeof payload.grouping === "string" ? payload.grouping : "na";
  return {
    orders,
    grouping,
    builder: { b: hlAddress(BUILDER_ADDRESS), f: BUILDER_FEE_TENTHS },
  };
}

export function assertCanTrade(source) {
  if (source !== "wallet") {
    throw new Error("Connect a wallet to place orders.");
  }
}

export function explainExchangeError(result) {
  if (result == null) return "No response from Hyperliquid.";
  if (typeof result === "string") return result;
  if (result.status === "err") {
    return typeof result.response === "string" ? result.response : JSON.stringify(result.response);
  }
  const statuses = result.response && result.response.data && result.response.data.statuses;
  if (Array.isArray(statuses)) {
    const err = statuses.find((s) => s && s.error);
    if (err) return err.error;
    const twap = result.response.data.status;
    if (twap && twap.error) return twap.error;
  }
  const twapStatus = result.response && result.response.data && result.response.data.status;
  if (twapStatus && twapStatus.error) return twapStatus.error;
  if (result.message) return result.message;
  return null;
}

/**
 * Ticket / wallet / SDK errors. Do not treat a missing `err.response` as an
 * exchange null — that used to replace every thrown Error with
 * "No response from Hyperliquid."
 */
export function userMessage(err) {
  if (!err) return "Request failed.";
  if (err.code === 4001 || err.code === "ACTION_REJECTED") return "Wallet rejected the signature.";
  if (err.response != null) {
    const fromApi = explainExchangeError(err.response);
    if (fromApi) return fromApi;
  }
  const msg = err.message || String(err);
  if (/user rejected|denied|rejected the request/i.test(msg)) return "Wallet rejected the signature.";
  return msg;
}

export function orderSucceeded(result) {
  if (!result || result.status !== "ok") return false;
  const statuses = result.response && result.response.data && result.response.data.statuses;
  if (Array.isArray(statuses)) {
    if (statuses.some((s) => s && s.error)) return false;
    return statuses.some((s) => s && (s.resting || s.filled || s === "waitingForTrigger" || s === "waitingForFill"));
  }
  const st = result.response && result.response.data && result.response.data.status;
  if (st && st.running) return true;
  if (result.response && result.response.type === "default") return true;
  return result.status === "ok";
}

export function sizeFromMarginPct(withdrawable, markPx, pct, szDecimals) {
  const w = Number(withdrawable);
  const px = Number(markPx);
  const p = Number(pct);
  if (!Number.isFinite(w) || !Number.isFinite(px) || px <= 0 || !Number.isFinite(p)) return "";
  const notional = w * (p / 100);
  const sz = roundSz(notional / px, szDecimals);
  return sz > 0 ? toWire(sz) : "";
}
