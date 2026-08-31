import { roundPx, roundSz, toWire, buildOrderWire, sealOrderPayload } from "./order-build.js";

export const DEFAULT_MAX_SLIPPAGE = 0.08;

function sanitizeTicker(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Official TradingView Hyperliquid symbols. Perps: HYPERLIQUID:BTCUSDC.P. Spot: HYPERLIQUID:PURRUSDC. Outcomes have no TV symbol — return null so we never embed a wrong BTC chart. */
export function tvSymbol(coin, kind = "perp", base, quote) {
  if (kind === "outcome") return null;
  if (kind === "spot") {
    const b = sanitizeTicker(base || coin);
    const q = sanitizeTicker(quote || "USDC");
    if (!b) return "HYPERLIQUID:PURRUSDC";
    return "HYPERLIQUID:" + b + q;
  }
  const c = sanitizeTicker(coin);
  if (!c) return "HYPERLIQUID:BTCUSDC.P";
  return "HYPERLIQUID:" + c + "USDC.P";
}

export function tvInterval(interval) {
  return (
    {
      "1m": "1",
      "5m": "5",
      "15m": "15",
      "1h": "60",
      "4h": "240",
      "1d": "D",
    }[interval] || "15"
  );
}

export function nextFundingMs(now = Date.now()) {
  const hour = 60 * 60 * 1000;
  const next = Math.ceil(now / hour) * hour;
  return next <= now ? next + hour : next;
}

export function fundingCountdown(now = Date.now()) {
  const ms = Math.max(0, nextFundingMs(now) - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

/** Perp buying power: free USDC × leverage (isolated/cross). */
export function buyingPower(availableUsdc, leverage) {
  const w = Number(availableUsdc);
  const lev = Number(leverage);
  if (!Number.isFinite(w) || w <= 0) return 0;
  if (!Number.isFinite(lev) || lev <= 0) return w;
  return w * lev;
}

/**
 * Size in coin from a percent of available buying power (USDC notional).
 * `availableUsdc` is already buying power (withdrawable × leverage).
 */
export function sizeFromAvailablePct(availableUsdc, px, pct, szDecimals) {
  const w = Number(availableUsdc);
  const price = Number(px);
  const p = Number(pct);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(p)) {
    return 0;
  }
  const notional = w * (Math.max(0, Math.min(100, p)) / 100);
  return roundSz(notional / price, szDecimals);
}

export function coinsFromUsdc(usdc, px, szDecimals) {
  const u = Number(usdc);
  const price = Number(px);
  if (!Number.isFinite(u) || !Number.isFinite(price) || price <= 0) return 0;
  return roundSz(u / price, szDecimals);
}

export function usdcFromCoins(sz, px) {
  const s = Number(sz);
  const price = Number(px);
  if (!Number.isFinite(s) || !Number.isFinite(price)) return NaN;
  return s * price;
}

export function orderValue(sz, px) {
  return usdcFromCoins(sz, px);
}

export function marginRequired(notional, leverage) {
  const n = Number(notional);
  const lev = Number(leverage);
  if (!Number.isFinite(n) || !Number.isFinite(lev) || lev <= 0) return NaN;
  return n / lev;
}

export function estimateLiqPx(mark, leverage, isBuy) {
  const m = Number(mark);
  const lev = Number(leverage);
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(lev) || lev <= 0) return NaN;
  const dist = 1 / lev;
  return isBuy ? m * (1 - dist) : m * (1 + dist);
}

export function estimateSlippage(orderPx, mid, isMarket) {
  const px = Number(orderPx);
  const m = Number(mid);
  if (!Number.isFinite(m) || m <= 0) return 0;
  if (!isMarket && Number.isFinite(px) && px > 0) return Math.abs(px - m) / m;
  return 0;
}

export function formatFeePct(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + "%";
}

export function change24h(mark, prevDay) {
  const m = Number(mark);
  const p = Number(prevDay);
  if (!Number.isFinite(m) || !Number.isFinite(p) || p <= 0) return NaN;
  return (m - p) / p;
}

/**
 * Split total size into `count` limit orders between start and end price.
 */
export function buildScaleWires({
  asset,
  isBuy,
  size,
  startPx,
  endPx,
  count,
  szDecimals,
  reduceOnly = false,
}) {
  const n = Math.max(2, Math.min(50, Math.round(Number(count) || 2)));
  const total = Number(size);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Enter a size greater than zero");
  const start = Number(startPx);
  const end = Number(endPx);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end) || end <= 0) {
    throw new Error("Enter a start and end price");
  }
  const per = total / n;
  const wires = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const px = start + (end - start) * t;
    wires.push(
      buildOrderWire({
        asset,
        isBuy,
        size: per,
        price: px,
        type: "limit",
        tif: "Gtc",
        reduceOnly,
        szDecimals,
      })
    );
  }
  return wires;
}

export function sealScalePayload(wires) {
  return sealOrderPayload({ orders: wires, grouping: "na" });
}

export { roundPx, roundSz, toWire };
