/**
 * HIP-4 picker volume / open interest from the same spot-asset ctxs
 * app.hyperliquid.xyz uses (websocket `sac`, raw-deflate snapshots).
 *
 * Volume: Yes-side `dayNtlVlm` (USD notional).
 * Open interest: (Yes circulatingSupply + No circulatingSupply) / 2
 * — complete sets, $1 collateral each. Never invents values.
 */
import { HL_WS } from "./hosts.js";

export function decodeHlCompressedJson(b64) {
  const raw = String(b64 || "");
  if (!raw) return null;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return inflateRawUtf8(bytes).then((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
}

function inflateRawUtf8(bytes) {
  if (typeof DecompressionStream !== "function") {
    return Promise.reject(new Error("deflate-raw is not available"));
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer().then((buf) => new TextDecoder().decode(buf));
}

/** Map `#coin` → ctx from a sac snapshot or already-decoded object. */
export function indexSpotAssetCtxs(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out = {};
  Object.keys(payload).forEach((key) => {
    const row = payload[key];
    if (!row || typeof row !== "object") return;
    const coin = String(row.coin || key || "");
    if (!coin) return;
    out[coin] = row;
  });
  return out;
}

export function outcomeDayNotional(yesCtx) {
  if (!yesCtx || yesCtx.dayNtlVlm == null || yesCtx.dayNtlVlm === "") return null;
  const n = Number(yesCtx.dayNtlVlm);
  return Number.isFinite(n) ? n : null;
}

/**
 * Same formula as Hyperliquid CoinSelector `lne`: average of Yes+No
 * circulatingSupply. Requires the Yes-side ctx (HL gates OI on that).
 */
export function outcomeOpenInterestShares(yesCtx, noCtx) {
  if (!yesCtx) return null;
  const y = Number(yesCtx.circulatingSupply);
  const n = Number(noCtx && noCtx.circulatingSupply);
  const yv = Number.isFinite(y) ? y : 0;
  const nv = Number.isFinite(n) ? n : 0;
  return (yv + nv) / 2;
}

export function enrichOutcomeMarkets(markets, ctxByCoin) {
  const ctxs = ctxByCoin && typeof ctxByCoin === "object" ? ctxByCoin : {};
  return (markets || []).map((m) => {
    if (!m || m.kind !== "outcome") return m;
    const yes = ctxs[m.coin];
    const no = ctxs[m.noCoin];
    const dayNtlVlm = outcomeDayNotional(yes);
    const openInterest = outcomeOpenInterestShares(yes, no);
    let prevDayPx = m.prevDayPx;
    if (yes && yes.prevDayPx != null && yes.prevDayPx !== "") prevDayPx = yes.prevDayPx;
    return Object.assign({}, m, {
      dayNtlVlm: dayNtlVlm == null ? m.dayNtlVlm : dayNtlVlm,
      openInterest: openInterest == null ? m.openInterest : openInterest,
      prevDayPx,
    });
  });
}

export function fetchSpotAssetCtxs({ timeoutMs = 8000, WebSocketImpl } = {}) {
  const WS = WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
  if (!WS) return Promise.resolve({});
  return new Promise((resolve) => {
    let settled = false;
    let ws = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (ws) ws.close();
      } catch {
        /* ignore */
      }
      resolve(value && typeof value === "object" ? value : {});
    };
    const timer = setTimeout(() => finish({}), timeoutMs);
    try {
      ws = new WS(HL_WS);
    } catch {
      finish({});
      return;
    }
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "sac" } }));
      } catch {
        finish({});
      }
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (!msg || msg.channel !== "sac") return;
      const data = msg.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        finish(indexSpotAssetCtxs(data));
        return;
      }
      if (typeof data !== "string") return;
      decodeHlCompressedJson(data)
        .then((parsed) => finish(indexSpotAssetCtxs(parsed)))
        .catch(() => finish({}));
    };
    ws.onerror = () => finish({});
  });
}
