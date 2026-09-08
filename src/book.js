export function bookPrecisions(px) {
  const n = Number(px);
  const exp = Number.isFinite(n) && n > 0 ? Math.floor(Math.log10(n)) : 0;
  const start = Math.max(exp - 6, -6);
  const end = Math.max(exp - 1, start);
  const steps = [];
  for (let e = start; e <= end; e++) {
    const v = Number(Math.pow(10, e).toPrecision(6));
    if (v > 0 && steps[steps.length - 1] !== v) steps.push(v);
  }
  return steps.length ? steps : [0.01, 0.1, 1];
}

export function defaultPrecision(px) {
  const steps = bookPrecisions(px);
  const n = Number(px);
  const want = Number.isFinite(n) && n > 0 ? n * 1e-5 : steps[0];
  let best = steps[0];
  let bestD = Infinity;
  steps.forEach((s) => {
    const d = Math.abs(Math.log(s / want));
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  });
  return best;
}

export function formatPrec(step) {
  const n = Number(step);
  if (!Number.isFinite(n) || n <= 0) return "0.01";
  if (n >= 1) return String(Math.round(n));
  const s = n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return s || String(n);
}

/**
 * Group L2 levels onto `step`. Asks round up (away from bid); bids round down.
 * Input: HL order (asks ascending, bids descending). Output same order.
 */
export function aggregateLevels(levels, step, side) {
  const st = Number(step);
  if (!Number.isFinite(st) || st <= 0) {
    return (levels || []).map((lv) => ({ px: Number(lv.px), sz: Number(lv.sz) })).filter((lv) => Number.isFinite(lv.px) && Number.isFinite(lv.sz));
  }
  const map = new Map();
  (levels || []).forEach((lv) => {
    const px = Number(lv.px);
    const sz = Number(lv.sz);
    if (!Number.isFinite(px) || !Number.isFinite(sz) || sz <= 0) return;
    const n = px / st;
    const bucket = side === "ask" ? Math.ceil(n - 1e-10) * st : Math.floor(n + 1e-10) * st;
    const key = bucket.toFixed(8);
    map.set(key, (map.get(key) || 0) + sz);
  });
  const out = [];
  map.forEach((sz, key) => out.push({ px: Number(key), sz }));
  out.sort((a, b) => (side === "ask" ? a.px - b.px : b.px - a.px));
  return out;
}

export function spreadParts(bid, ask) {
  const b = Number(bid);
  const a = Number(ask);
  if (!Number.isFinite(b) || !Number.isFinite(a) || a <= 0 || b <= 0) return null;
  const abs = a - b;
  const mid = (a + b) / 2;
  const pct = mid > 0 ? (abs / mid) * 100 : NaN;
  return { abs, pct };
}

export function mergeTrades(existing, incoming, limit = 80) {
  const out = [];
  const seen = new Set();
  function add(t) {
    if (!t) return;
    const id = t.tid != null ? "t" + t.tid : t.hash ? String(t.hash) : t.time + ":" + t.px + ":" + t.sz;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(t);
  }
  (incoming || []).forEach(add);
  (existing || []).forEach(add);
  out.sort((a, b) => Number(b.time) - Number(a.time));
  return out.slice(0, limit);
}

export const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
export const HL_EXPLORER_TX = "https://app.hyperliquid.xyz/explorer/tx/";

export function tradeHashHref(hash) {
  const raw = String(hash || "");
  if (!TX_HASH_RE.test(raw)) return null;
  return HL_EXPLORER_TX + raw;
}

export function formatBookPx(px, step) {
  const n = Number(px);
  if (!Number.isFinite(n)) return "—";
  let decimals = 2;
  if (Number.isFinite(step) && step > 0) {
    decimals = step >= 1 ? 0 : Math.min(8, Math.max(0, Math.round(-Math.log10(step) + 1e-9)));
  } else {
    const abs = Math.abs(n);
    decimals = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatSpreadLabel(bid, ask) {
  const p = spreadParts(bid, ask);
  if (!p) return "—";
  const abs = Math.abs(p.abs);
  const absStr = p.abs.toLocaleString("en-US", {
    minimumFractionDigits: abs >= 1 ? 2 : 3,
    maximumFractionDigits: abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6,
  });
  const pctStr = Number.isFinite(p.pct)
    ? p.pct.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + "%"
    : "—";
  return "[ " + absStr + " " + pctStr + " ]";
}

export function formatTradeTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (x) => String(x).padStart(2, "0");
  return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

export function tradeIsBuy(side) {
  const s = String(side || "").toUpperCase();
  return s === "B" || s === "BUY" || s === "BID";
}
