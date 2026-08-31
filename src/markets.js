import { fmtPx } from "./format.js";
import { HL_COIN_ICON_BASE } from "./hosts.js";
import { change24h } from "./ticket-math.js";

export const FAV_KEY = "ht.fav.markets";
export const SPOT_ASSET_OFFSET = 10_000;

function tokenByIndex(tokens, index) {
  if (!Array.isArray(tokens)) return null;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] && tokens[i].index === index) return tokens[i];
  }
  return null;
}

function ctxByCoin(ctxs, coin) {
  if (!Array.isArray(ctxs)) return {};
  for (let i = 0; i < ctxs.length; i++) {
    if (ctxs[i] && ctxs[i].coin === coin) return ctxs[i];
  }
  return {};
}

export function displayPair(base, quote) {
  const b = String(base || "").trim();
  const q = String(quote || "USDC").trim();
  if (!b) return q;
  return b + "/" + q;
}

const COIN_ICON_RE = /^[A-Za-z0-9]+$/;

/** Official app.hyperliquid.xyz coin SVG. k-prefixed perps (kPEPE) use the un-k'd icon. */
export function coinIconUrl(symbol) {
  let name = String(symbol || "").trim();
  if (!COIN_ICON_RE.test(name)) return null;
  if (/^k[A-Z]/.test(name)) name = name.slice(1);
  if (!COIN_ICON_RE.test(name)) return null;
  return HL_COIN_ICON_BASE + name + ".svg";
}

export function iconSymbol(market) {
  if (!market) return "";
  if (market.kind === "spot" && market.base) return market.base;
  if (market.kind === "outcome") return market.underlying || "";
  return market.coin || market.base || "";
}

/** Hourly funding from Info ctx → 8h rate Hyperliquid shows in the picker. */
export function funding8h(hourly) {
  const n = Number(hourly);
  if (!Number.isFinite(n)) return NaN;
  return n * 8;
}

export function compactUsd(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const v = abs;
  if (v >= 1e9) return sign + "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return sign + "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return sign + "$" + (v / 1e3).toFixed(1) + "K";
  return sign + "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function parsePerpMarkets(payload) {
  const meta = payload && payload[0];
  const ctxs = payload && payload[1];
  const universe = (meta && meta.universe) || [];
  const out = [];
  universe.forEach((u, i) => {
    if (!u || u.isDelisted) return;
    const ctx = (ctxs && ctxs[i]) || {};
    const coin = u.name;
    const base = coin;
    const quote = "USDC";
    out.push({
      id: "perp:" + coin,
      kind: "perp",
      coin,
      base,
      quote,
      pair: displayPair(base, quote),
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
  return out;
}

export function parseSpotMarkets(payload) {
  const meta = payload && payload[0];
  const ctxs = payload && payload[1];
  const universe = (meta && meta.universe) || [];
  const tokens = (meta && meta.tokens) || [];
  const out = [];
  universe.forEach((u) => {
    if (!u || u.isDelisted) return;
    const coin = u.name;
    const ctx = ctxByCoin(ctxs, coin) || {};
    const ids = u.tokens || [];
    const baseTok = tokenByIndex(tokens, ids[0]);
    const quoteTok = tokenByIndex(tokens, ids[1]);
    const base = (baseTok && baseTok.name) || coin;
    const quote = (quoteTok && quoteTok.name) || "USDC";
    const index = Number(u.index);
    out.push({
      id: "spot:" + coin,
      kind: "spot",
      coin,
      base,
      quote,
      pair: displayPair(base, quote),
      asset: SPOT_ASSET_OFFSET + (Number.isInteger(index) ? index : 0),
      szDecimals: baseTok ? baseTok.szDecimals : 8,
      maxLeverage: null,
      onlyIsolated: false,
      markPx: ctx.markPx,
      midPx: ctx.midPx,
      oraclePx: ctx.oraclePx || ctx.markPx,
      funding: null,
      openInterest: null,
      dayNtlVlm: ctx.dayNtlVlm,
      prevDayPx: ctx.prevDayPx,
    });
  });
  return out;
}

export function mergeMarkets(perps, spot, outcomes) {
  const all = (perps || []).concat(spot || []).concat(outcomes || []);
  all.sort((a, b) => Number(b.dayNtlVlm || 0) - Number(a.dayNtlVlm || 0));
  return all;
}

export function marketSearchText(m) {
  if (!m) return "";
  return [m.coin, m.base, m.quote, m.pair, m.id, m.kind, m.description, m.underlying, m.venue].join(" ").toLowerCase();
}

export function changeAbs(mark, prevDay) {
  const m = Number(mark);
  const p = Number(prevDay);
  if (!Number.isFinite(m) || !Number.isFinite(p)) return NaN;
  return m - p;
}

/** Live picker cell: `+$1.23 / +1.23%` green, or red with minus. No fabricated values. */
export function formatPickerChange(mark, prevDay) {
  const ch = change24h(mark, prevDay);
  const abs = changeAbs(mark, prevDay);
  if (!Number.isFinite(ch)) return { text: "—", cls: "mp-muted" };
  const pct =
    (ch > 0 ? "+" : "") +
    (ch * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    "%";
  let pxPart = "";
  if (Number.isFinite(abs)) {
    const mag = fmtPx(Math.abs(abs), true);
    const sign = abs > 0 ? "+" : abs < 0 ? "-" : "";
    pxPart = sign + mag + " / ";
  }
  const cls = ch > 0 ? "mp-chg up" : ch < 0 ? "mp-chg down" : "mp-muted";
  return { text: pxPart + pct, cls };
}

export function sortMarkets(rows, sortKey, sortDir) {
  const dir = sortDir === "asc" ? 1 : -1;
  const list = (rows || []).slice();
  list.sort((a, b) => {
    let av;
    let bv;
    if (sortKey === "change") {
      av = change24h(a.markPx, a.prevDayPx);
      bv = change24h(b.markPx, b.prevDayPx);
    } else if (sortKey === "funding") {
      av = funding8h(a.funding);
      bv = funding8h(b.funding);
    } else if (sortKey === "oi") {
      const am = Number(a.markPx);
      const bm = Number(b.markPx);
      av = Number(a.openInterest) * (Number.isFinite(am) ? am : 1);
      bv = Number(b.openInterest) * (Number.isFinite(bm) ? bm : 1);
    } else if (sortKey === "price") {
      av = Number(a.markPx || a.midPx);
      bv = Number(b.markPx || b.midPx);
    } else {
      av = Number(a.dayNtlVlm);
      bv = Number(b.dayNtlVlm);
    }
    const aOk = Number.isFinite(av);
    const bOk = Number.isFinite(bv);
    if (!aOk && !bOk) return String(a.pair).localeCompare(String(b.pair));
    if (!aOk) return 1;
    if (!bOk) return -1;
    if (av === bv) return String(a.pair).localeCompare(String(b.pair));
    return av > bv ? dir : -dir;
  });
  return list;
}

export function filterMarkets(
  markets,
  { tab = "all", query = "", favs = [], sortKey = "change", sortDir = "desc", kinds } = {}
) {
  let rows = markets || [];
  if (Array.isArray(kinds) && kinds.length) {
    const set = new Set(kinds);
    rows = rows.filter((m) => set.has(m.kind));
  }
  if (tab === "perps") rows = rows.filter((m) => m.kind === "perp");
  else if (tab === "spot") rows = rows.filter((m) => m.kind === "spot");
  else if (tab === "outcome") rows = rows.filter((m) => m.kind === "outcome");
  else if (tab === "favorites") {
    const set = new Set(favs);
    rows = rows.filter((m) => set.has(m.id));
  } else if (tab === "trending") {
    rows = sortMarkets(rows, "volume", "desc").slice(0, 20);
  }
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (q) {
    rows = rows.filter((m) => marketSearchText(m).indexOf(q) !== -1);
  }
  if (tab !== "trending") rows = sortMarkets(rows, sortKey, sortDir);
  else if (q) rows = sortMarkets(rows, sortKey, sortDir);
  return rows;
}

export function loadFavs(store) {
  const ls = store || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!ls) return [];
  try {
    const raw = ls.getItem(FAV_KEY);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === "string" && x.length < 80).slice(0, 200);
  } catch {
    return [];
  }
}

export function saveFavs(ids, store) {
  const ls = store || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!ls) return;
  const list = (ids || []).filter((x) => typeof x === "string").slice(0, 200);
  ls.setItem(FAV_KEY, JSON.stringify(list));
}

export function toggleFav(id, store) {
  const favs = loadFavs(store);
  const i = favs.indexOf(id);
  if (i === -1) favs.push(id);
  else favs.splice(i, 1);
  saveFavs(favs, store);
  return favs;
}
