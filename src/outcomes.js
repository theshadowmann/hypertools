/**
 * HIP-4 outcome / prediction markets (not HIP-3 builder-deployed perps).
 *
 * Live Info:
 *   POST /info  { "type": "outcomeMeta" }     → outcomes[], questions[]
 *   POST /info  { "type": "allMids" }         → mids keyed "#12090", "#12091", …
 *   POST /info  { "type": "l2Book", coin }    → levels for "#12100"
 *   POST /info  { "type": "recentTrades", coin }
 *   POST /info  { "type": "spotClearinghouseState" }  balances[].coin like "+12100"
 *
 * Exchange: same `order` action as perps. Asset `a` = 100_000_000 + 10*id + side.
 * Size is integer shares. Price is probability [0.001, 0.999] tick 0.0001.
 * Collateral quoteToken from live meta is USDC. No leverage / funding.
 */

export const OUTCOME_ASSET_OFFSET = 100_000_000;

/** Coin string for l2Book, candles, Exchange.order, websocket. Side 0 = Yes, 1 = No. */
export function encodeOutcomeCoin(outcomeId, side) {
  const id = Number(outcomeId);
  const s = Number(side);
  if (!Number.isInteger(id) || id < 0 || (s !== 0 && s !== 1)) return "";
  return "#" + (10 * id + s);
}

/** Balance coin in spotClearinghouseState. */
export function encodeOutcomeBalance(outcomeId, side) {
  const id = Number(outcomeId);
  const s = Number(side);
  if (!Number.isInteger(id) || id < 0 || (s !== 0 && s !== 1)) return "";
  return "+" + (10 * id + s);
}

/** Integer asset id for the order wire `a` field. */
export function encodeOutcomeAsset(outcomeId, side) {
  const id = Number(outcomeId);
  const s = Number(side);
  if (!Number.isInteger(id) || id < 0 || (s !== 0 && s !== 1)) return NaN;
  return OUTCOME_ASSET_OFFSET + 10 * id + s;
}

export function parseOutcomeFields(desc) {
  const out = {};
  String(desc || "")
    .split("|")
    .forEach((part) => {
      const i = part.indexOf(":");
      if (i <= 0) return;
      out[part.slice(0, i)] = part.slice(i + 1);
    });
  return out;
}

function padTimeLabel(raw) {
  const m = String(raw || "").match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return raw || "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m[2]) - 1];
  if (!month) return raw;
  const hour = Number(m[4]);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return month + " " + Number(m[3]) + ", " + m[1] + " at " + h12 + ":" + m[5] + " " + ampm;
}

function underlyingTicker(fields) {
  const raw = String(fields.perp || fields.underlying || "").trim();
  if (!raw) return "";
  return raw.replace(/^xyz:/i, "");
}

/**
 * Human title from live outcomeMeta fields only. Never invents an event name.
 * Falls back to the API description or name when the description is unstructured.
 */
export function formatOutcomeTitle(outcome, question) {
  const o = outcome || {};
  const q = question || null;
  const fields = Object.assign({}, parseOutcomeFields(q && q.description), parseOutcomeFields(o.description));
  const und = underlyingTicker(fields);
  const strike = fields.threshold || fields.target || fields.targetPrice;
  const when = padTimeLabel(fields.time || fields.expiry || "");
  const name = String(o.name || "");
  if (und && strike && when) {
    const touch = /priceTouch/i.test(name) || fields.class === "priceTouch";
    return und + (touch ? " touches " : " above ") + strike + " on " + when + "?";
  }
  if (q && (fields.institution || fields.decisionLabel || fields.policyMeasure)) {
    const bits = [fields.institution, fields.decisionLabel, fields.policyMeasure].filter(Boolean);
    const side = String(o.name || "").replace(/^template:/, "");
    return (bits.join(" · ") + (side ? " (" + side + ")" : "")).trim();
  }
  if (o.description && o.description !== "other") return String(o.description);
  if (o.name) return String(o.name).replace(/^template:/, "");
  if (o.outcome != null) return "Outcome " + o.outcome;
  return "";
}

export function isOutcomeMarket(m) {
  return !!(m && m.kind === "outcome");
}

export function isOutcomeCoin(coin) {
  const s = String(coin || "");
  return s.charAt(0) === "#" || s.charAt(0) === "+";
}

export function roundOutcomePx(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return NaN;
  const clamped = Math.min(0.999, Math.max(0.001, n));
  return Math.round(clamped * 10000) / 10000;
}

/**
 * HIP-4 share balances live in spotClearinghouseState under `+{encoding}` coins.
 */
export function outcomePositionsFromSpot(balances, markets) {
  const byKey = {};
  (markets || []).forEach((m) => {
    if (!m || m.kind !== "outcome") return;
    if (m.balanceCoin) byKey[m.balanceCoin] = m;
    if (m.noBalanceCoin) byKey[m.noBalanceCoin] = m;
    if (m.coin) byKey[m.coin] = m;
    if (m.noCoin) byKey[m.noCoin] = m;
  });
  const rows = [];
  (balances || []).forEach((b) => {
    if (!b || !isOutcomeCoin(b.coin)) return;
    const total = Number(b.total);
    if (!Number.isFinite(total) || Math.abs(total) < 1e-8) return;
    const enc = Number(String(b.coin).slice(1));
    const side = Number.isInteger(enc) ? enc % 10 : 0;
    const m = byKey[b.coin] || byKey["#" + String(b.coin).slice(1)] || null;
    const mark = m ? (side === 1 ? m.noMarkPx : m.markPx) : null;
    rows.push({
      coin: b.coin,
      side: side === 1 ? "No" : "Yes",
      title: m ? m.pair : String(b.coin),
      marketId: m ? m.id : null,
      total,
      hold: Number(b.hold) || 0,
      available: total - (Number(b.hold) || 0),
      markPx: mark,
      entryNtl: b.entryNtl,
    });
  });
  return rows;
}

/**
 * One tradeable Yes-side row per live outcomeMeta entry.
 * Prices come from allMids `#` keys. Missing mids stay blank — never fabricated.
 */
export function parseOutcomeMarkets(meta, mids) {
  const questions = (meta && meta.questions) || [];
  const qById = {};
  questions.forEach((q) => {
    if (!q) return;
    (q.namedOutcomes || []).forEach((id) => {
      qById[id] = q;
    });
    if (q.fallbackOutcome != null) qById[q.fallbackOutcome] = q;
  });
  const px = mids && typeof mids === "object" ? mids : {};
  const out = [];
  ((meta && meta.outcomes) || []).forEach((o) => {
    if (!o || o.outcome == null) return;
    const id = Number(o.outcome);
    if (!Number.isInteger(id) || id < 0) return;
    const yesCoin = encodeOutcomeCoin(id, 0);
    const noCoin = encodeOutcomeCoin(id, 1);
    if (!yesCoin) return;
    const title = formatOutcomeTitle(o, qById[id]);
    if (!title) return;
    const yesPx = px[yesCoin];
    const noPx = px[noCoin];
    const fields = parseOutcomeFields(o.description);
    out.push({
      id: "outcome:" + id + ":0",
      kind: "outcome",
      coin: yesCoin,
      noCoin,
      balanceCoin: encodeOutcomeBalance(id, 0),
      noBalanceCoin: encodeOutcomeBalance(id, 1),
      outcomeId: id,
      side: 0,
      base: "Yes",
      quote: o.quoteToken || "USDC",
      pair: title,
      asset: encodeOutcomeAsset(id, 0),
      noAsset: encodeOutcomeAsset(id, 1),
      szDecimals: 0,
      maxLeverage: null,
      onlyIsolated: false,
      markPx: yesPx,
      midPx: yesPx,
      oraclePx: yesPx,
      funding: null,
      openInterest: null,
      dayNtlVlm: null,
      prevDayPx: null,
      venue: o.venue || null,
      description: o.description || "",
      underlying: underlyingTicker(fields),
      noMarkPx: noPx,
    });
  });
  return out;
}
