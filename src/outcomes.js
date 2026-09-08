/**
 * HIP-4 outcome / prediction markets (not HIP-3 builder-deployed perps).
 *
 * Live Info:
 *   POST /info  { "type": "outcomeMeta" }     → outcomes[], questions[]
 *   POST /info  { "type": "outcomeTemplates" } → template names used for out: chart slugs
 *   POST /info  { "type": "allMids" }         → mids keyed "#12090", "#12091", …
 *   POST /info  { "type": "l2Book", coin }    → levels for "#12100"
 *   POST /info  { "type": "recentTrades", coin }
 *   POST /info  { "type": "spotClearinghouseState" }  balances[].coin like "+12100"
 *   WS `sac` snapshot  → dayNtlVlm + circulatingSupply on `#` coins
 *                       (same source app.hyperliquid.xyz uses for Volume / OI)
 *
 * Exchange: same `order` action as perps. Asset `a` = 100_000_000 + 10*id + side.
 * Size is integer shares. Price is probability [0.001, 0.999] tick 0.0001.
 * Collateral quoteToken from live meta is USDC. No leverage / funding.
 */
import { pnlPctFromEntry } from "./balances.js";

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

const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same kebab rules Hyperliquid uses for Charting Library / URL tickers. */
export function outcomeSlugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** UTC label Hyperliquid fills into `{time}` before slugifying (`Sep 7 at 6:00 AM UTC`). */
export function formatOutcomeUtcLabel(raw) {
  const m = String(raw || "").match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return String(raw || "");
  const month = UTC_MONTHS[Number(m[2]) - 1];
  if (!month) return String(raw || "");
  const hour = Number(m[4]);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return month + " " + Number(m[3]) + " at " + h12 + ":" + m[5] + " " + ampm + " UTC";
}

function formatTemplateHint(value, hint) {
  if (hint === "dateTime") return formatOutcomeUtcLabel(value);
  return String(value ?? "");
}

function indexOutcomeTemplates(templates) {
  const byId = new Map();
  (Array.isArray(templates) ? templates : []).forEach((t) => {
    if (t && t.id) byId.set(String(t.id), t);
  });
  return byId;
}

function templateIdFromName(name) {
  const raw = String(name || "");
  return raw.startsWith("template:") ? raw.slice(9) : "";
}

function fillOutcomeTemplate(templateStr, fields, keywords) {
  const src = String(templateStr || "");
  if (!src) return "";
  if (src.indexOf("{") < 0) return src;
  let out = src;
  const pairs = Array.isArray(keywords) ? keywords : [];
  for (let i = 0; i < pairs.length; i++) {
    const keyword = pairs[i] && pairs[i][0];
    const hint = pairs[i] && pairs[i][1];
    if (!keyword) continue;
    if (fields[keyword] === undefined) return "";
    out = out.split("{" + keyword + "}").join(formatTemplateHint(fields[keyword], hint));
  }
  return out;
}

function venueTicker(venue, slug) {
  const body = outcomeSlugify(slug);
  if (!body) return "";
  const prefix = outcomeSlugify(venue);
  return prefix ? prefix + ":" + body : body;
}

/**
 * Hyperliquid Charting Library ticker for a Yes/No leg, e.g.
 * `out:pons-touches-1-by-sep-7-at-600-am-utc-yes`. Built only from
 * outcomeTemplates + outcomeMeta. Empty when a template cannot be resolved.
 */
export function outcomeLegTvTickers(outcome, question, templates) {
  const o = outcome || {};
  const byId = templates instanceof Map ? templates : indexOutcomeTemplates(templates);
  const tmpl = byId.get(templateIdFromName(o.name));
  if (!tmpl) return { yes: "", no: "" };
  const fields = Object.assign({}, parseOutcomeFields(question && question.description), parseOutcomeFields(o.description));
  const filled = fillOutcomeTemplate(tmpl.name, fields, tmpl.keywords);
  if (!filled) return { yes: "", no: "" };
  const outcomeSlug = outcomeSlugify(filled);
  const qTmpl = question ? byId.get(templateIdFromName(question.name)) : null;
  const qFields = question ? parseOutcomeFields(question.description) : {};
  const qFilled = qTmpl ? fillOutcomeTemplate(qTmpl.name, qFields, qTmpl.keywords) : "";
  const qSlug = qFilled ? outcomeSlugify(qFilled) : "";
  const role = tmpl.role && tmpl.role.standaloneOutcome;
  const sideNames = role && Array.isArray(role.sideNames) ? role.sideNames : ["Yes", "No"];
  const yesSide = outcomeSlugify(fillOutcomeTemplate(sideNames[0] || "Yes", fields, tmpl.keywords) || "Yes") || "yes";
  const noSide = outcomeSlugify(fillOutcomeTemplate(sideNames[1] || "No", fields, tmpl.keywords) || "No") || "no";
  const stem = qSlug ? qSlug + "-" + outcomeSlug : outcomeSlug;
  const venue = o.venue || "";
  return {
    yes: venueTicker(venue, stem + "-" + yesSide),
    no: venueTicker(venue, stem + "-" + noSide),
  };
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

function stripTemplatePrefix(name) {
  return String(name || "").replace(/^template:\s*/i, "").trim();
}

function isFieldDump(s) {
  const t = String(s || "");
  return t.indexOf("|") >= 0 && /[A-Za-z]+:/.test(t);
}

/** API junk that must never reach the picker or stats chip. */
export function isJunkOutcomeTitle(s) {
  const t = String(s || "").trim();
  if (!t) return true;
  if (/^template\s*fallback$/i.test(t)) return true;
  if (/^recurring(\s+fallback)?$/i.test(t)) return true;
  if (/^recurring named outcome$/i.test(t)) return true;
  if (/^other$/i.test(t)) return true;
  if (/^template:/i.test(t)) return true;
  if (isFieldDump(t)) return true;
  return false;
}

function isFallbackOutcome(outcome, question) {
  const name = String((outcome && outcome.name) || "");
  if (/fallback/i.test(name)) return true;
  if (!question || question.fallbackOutcome == null || !outcome) return false;
  return Number(question.fallbackOutcome) === Number(outcome.outcome);
}

function displayCompetition(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^USA National Football League/i.test(s) || (/National Football League/i.test(s) && /\bNFL\b/.test(s))) return "NFL";
  if (/womens?\s+us open/i.test(s)) return "Women's US Open";
  return s;
}

function displayStage(raw) {
  const s = String(raw || "").trim();
  if (!s || /^(match|game|regular season)$/i.test(s)) return "";
  return s;
}

function policySideLabel(name, filled) {
  if (filled && !isJunkOutcomeTitle(filled) && filled.indexOf("{") < 0) return filled;
  const id = templateIdFromName(name) || stripTemplatePrefix(name);
  if (/decrease/i.test(id)) return "Decrease";
  if (/increase/i.test(id)) return "Increase";
  if (/nochange|no.?change/i.test(id)) return "No change";
  return "";
}

function formatMatchTitle(fields, opts) {
  const vs = fields.participantA + " vs " + fields.participantB;
  const head = joinTitle([displayCompetition(fields.competition), displayStage(fields.stage)]);
  const base = head ? head + ": " + vs : vs;
  if (opts && opts.draw) return base + " · Draw";
  if (opts && opts.fallback) return base + " · Other";
  if (opts && opts.participant) return base + " · " + opts.participant;
  return base;
}

function formatPriceBucketTitle(und, fields, outcome, when) {
  const idx = Number(fields.index);
  const parts = String(fields.priceThresholds || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (Number.isInteger(idx) && idx >= 0 && parts.length >= 1) {
    if (idx === 0) return und + " below " + parts[0] + " on " + when + "?";
    if (idx === parts.length) return und + " above " + parts[parts.length - 1] + " on " + when + "?";
    if (idx > 0 && idx < parts.length) return und + " from " + parts[idx - 1] + " to " + parts[idx] + " on " + when + "?";
  }
  return und + " on " + when + "?";
}

function joinTitle(parts) {
  return parts.filter((p) => p != null && String(p).trim()).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Human title from live outcomeMeta + optional outcomeTemplates.
 * Never returns "template fallback", raw `key:value|` dumps, or invented names.
 */
export function formatOutcomeTitle(outcome, question, templates) {
  const title = buildOutcomeTitle(outcome, question, templates);
  if (title && !isJunkOutcomeTitle(title) && !/template\s*fallback/i.test(title)) return title;
  if (outcome && outcome.outcome != null) return "Outcome " + outcome.outcome;
  return "";
}

function buildOutcomeTitle(outcome, question, templates) {
  const o = outcome || {};
  const q = question || null;
  const fields = Object.assign({}, parseOutcomeFields(q && q.description), parseOutcomeFields(o.description));
  const byId = templates instanceof Map ? templates : indexOutcomeTemplates(templates);
  const oTmpl = byId.get(templateIdFromName(o.name));
  const qTmpl = q ? byId.get(templateIdFromName(q.name)) : null;
  const filledOutcome = oTmpl ? fillOutcomeTemplate(oTmpl.name, fields, oTmpl.keywords) : "";
  const filledQuestion = qTmpl ? fillOutcomeTemplate(qTmpl.name, fields, qTmpl.keywords) : "";
  const fallback = isFallbackOutcome(o, q);
  const side = stripTemplatePrefix(o.name);

  const und = underlyingTicker(fields) || String(fields.underlying || "").trim();
  const strike = fields.threshold || fields.target || fields.targetPrice;
  const when = padTimeLabel(fields.time || fields.expiry || "");
  const name = String(o.name || "");
  if (und && strike && when) {
    const touch = /priceTouch/i.test(name) || fields.class === "priceTouch";
    return und + (touch ? " touches " : " above ") + strike + " on " + when + "?";
  }
  if (und && fields.low && fields.high && when) {
    return und + " from " + fields.low + " to " + fields.high + " on " + when + "?";
  }
  if (und && fields.priceThresholds && when) {
    if (fallback) return und + " on " + when + " · Other";
    return formatPriceBucketTitle(und, fields, o, when);
  }

  if (fields.participantA && fields.participantB) {
    return formatMatchTitle(fields, {
      draw: /draw/i.test(side) || /draw/i.test(filledOutcome),
      fallback,
      participant: fields.participant || "",
    });
  }

  if (fields.participant && (fields.competition || fields.season)) {
    return joinTitle([fields.participant, "to win", fields.season, displayCompetition(fields.competition)]);
  }

  if (fallback && (fields.competition || fields.season)) {
    return joinTitle([fields.season, displayCompetition(fields.competition), "winner"]) + " · Other";
  }

  if (q && (fields.institution || fields.decisionLabel || fields.policyMeasure)) {
    const bits = [fields.institution, fields.decisionLabel].filter(Boolean);
    const head = bits.join(" · ");
    if (fallback) return (head + " · Other").replace(/^\s*·\s*/, "").trim();
    const label = policySideLabel(name, filledOutcome);
    return label ? (head + " · " + label).replace(/^\s*·\s*/, "").trim() : head;
  }

  if (fields.participant && filledQuestion && !isJunkOutcomeTitle(filledQuestion)) {
    return joinTitle([fields.participant, "to win", filledQuestion.replace(/\s+winner$/i, "")]);
  }
  if (fallback && filledQuestion && !isJunkOutcomeTitle(filledQuestion) && filledQuestion.indexOf("{") < 0) {
    return filledQuestion + " · Other";
  }
  if (filledOutcome && !isJunkOutcomeTitle(filledOutcome) && filledOutcome.indexOf("{") < 0) return filledOutcome;
  if (filledQuestion && !isJunkOutcomeTitle(filledQuestion) && filledQuestion.indexOf("{") < 0) return filledQuestion;

  const desc = String(o.description || "");
  if (desc && !isJunkOutcomeTitle(desc)) return desc;
  if (side && !isJunkOutcomeTitle(side) && !/fallback/i.test(side)) return side;
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

/** /outcome Balances: USDC plus Yes/No share tokens — not other spot. */
export function isOutcomePageBalance(coin) {
  return String(coin || "").toUpperCase() === "USDC" || isOutcomeCoin(coin);
}

export function roundOutcomePx(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return NaN;
  const clamped = Math.min(0.999, Math.max(0.001, n));
  return Math.round(clamped * 10000) / 10000;
}

export function parseOutcomeExpiryMs(fields) {
  const f = fields || {};
  const raw = f.time || f.expiry || f.decisionDeadline || f.scheduledDecision || "";
  const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(ms) ? ms : null;
}

export function formatOutcomeCountdown(expiryMs, now = Date.now()) {
  const end = Number(expiryMs);
  if (!Number.isFinite(end)) return "";
  const d = end - Number(now);
  if (d <= 0) return "Ended";
  const s = Math.floor(d / 1000);
  const days = Math.floor(s / 86400);
  const hrs = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return days + "d " + hrs + "h";
  if (hrs > 0) return hrs + "h " + mins + "m";
  return Math.max(1, mins) + "m";
}

export function formatChancePct(px) {
  if (px == null || px === "") return "—";
  const n = Number(px);
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
}

/** Decimal odds 1/price, e.g. 0.42 → "2.4x". Never invents a price. */
export function formatOutcomeOdds(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const odds = 1 / n;
  return odds.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "x";
}

export function outcomeLegCoin(m, leg) {
  if (!m) return "";
  return Number(leg) === 1 ? m.noCoin || "" : m.coin || "";
}

/** `+12300` / `#12300` → `#12300`. Rejects TV slugs and bare tickers. */
export function toOutcomeHashCoin(coin) {
  const s = String(coin || "").trim();
  if (s.charAt(0) === "#" && /^\d+$/.test(s.slice(1))) return s;
  if (s.charAt(0) === "+" && /^\d+$/.test(s.slice(1))) return "#" + s.slice(1);
  return "";
}

/**
 * candleSnapshot / l2Book coin for a Yes/No leg.
 * Always `#` form from `outcomeId`. Never TV tickers, bare ids, or `+` balances.
 */
export function outcomeCandleCoin(m, leg) {
  const idx = Number(leg) === 1 ? 1 : 0;
  if (m && m.outcomeId != null) {
    const encoded = encodeOutcomeCoin(m.outcomeId, idx);
    if (encoded) return encoded;
  }
  return toOutcomeHashCoin(outcomeLegCoin(m, idx));
}

/** Charting Library / public-TV ticker for the Yes or No leg. Empty when unknown. */
export function outcomeLegTvCoin(m, leg) {
  if (!m) return "";
  return Number(leg) === 1 ? m.noTvCoin || "" : m.yesTvCoin || "";
}

export function outcomeLegAsset(m, leg) {
  if (!m) return NaN;
  return Number(leg) === 1 ? m.noAsset : m.asset;
}

export function outcomeLegBalance(m, leg) {
  if (!m) return "";
  return Number(leg) === 1 ? m.noBalanceCoin || "" : m.balanceCoin || "";
}

/** Each share pays $1 if that side wins. */
export function outcomePayout(shares) {
  const n = Number(shares);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n;
}

/** Live venue strings only. Empty if the API omitted them. */
export function outcomeVenueBadge(venue) {
  const v = String(venue || "")
    .trim()
    .toLowerCase();
  if (v === "out" || v === "skew") return v;
  return "";
}

/** HIP-4 outcomeMeta has no Crypto/Economics/Sports field on live mainnet. */
export function outcomeCategories(meta) {
  const found = new Set();
  ((meta && meta.outcomes) || []).forEach((o) => {
    const cat = o && (o.category || o.group || o.sector);
    if (typeof cat === "string" && cat.trim()) found.add(cat.trim());
  });
  return [...found];
}

export function lookupUnderlyingPx(perpKey, mids, hip3Marks) {
  const raw = String(perpKey || "").trim();
  if (!raw) return null;
  const short = raw.replace(/^xyz:/i, "");
  const keys = [raw, short];
  if (raw.indexOf(":") < 0) keys.push("xyz:" + raw);
  const books = [mids, hip3Marks];
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (!book || typeof book !== "object") continue;
    for (let k = 0; k < keys.length; k++) {
      const px = book[keys[k]];
      if (px != null && Number(px) > 0) return px;
    }
  }
  return null;
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

/** Entry, mark value, and ROE from live spot fields only. Missing entryNtl stays blank. */
export function outcomePositionMetrics(row) {
  const size = Number(row && row.total);
  const mark = Number(row && row.markPx);
  const value = Number.isFinite(size) && Number.isFinite(mark) ? size * mark : NaN;
  const entryNtl = Number(row && row.entryNtl);
  const entryPx = Number.isFinite(entryNtl) && Number.isFinite(size) && size > 0 ? entryNtl / size : NaN;
  const pnlUsd = Number.isFinite(value) && Number.isFinite(entryNtl) ? value - entryNtl : NaN;
  const pnlPct = pnlPctFromEntry(row && row.entryNtl, value);
  return { value, entryPx, pnlUsd, pnlPct };
}

/**
 * One tradeable Yes-side row per live outcomeMeta entry.
 * Prices come from allMids `#` keys. Missing mids stay blank — never fabricated.
 * `templates` is the live `outcomeTemplates` list; used only for out: chart tickers.
 */
export function parseOutcomeMarkets(meta, mids, hip3Marks, templates) {
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
  const tmplIndex = indexOutcomeTemplates(templates);
  const out = [];
  ((meta && meta.outcomes) || []).forEach((o) => {
    if (!o || o.outcome == null) return;
    const id = Number(o.outcome);
    if (!Number.isInteger(id) || id < 0) return;
    const yesCoin = encodeOutcomeCoin(id, 0);
    const noCoin = encodeOutcomeCoin(id, 1);
    if (!yesCoin) return;
    let title = formatOutcomeTitle(o, qById[id], tmplIndex);
    if (!title || isJunkOutcomeTitle(title) || /template\s*fallback/i.test(title)) {
      title = "Outcome " + id;
    }
    const yesPx = px[yesCoin];
    const noPx = px[noCoin];
    const q = qById[id];
    const fields = Object.assign({}, parseOutcomeFields(q && q.description), parseOutcomeFields(o.description));
    const undKey = fields.perp || fields.underlying || "";
    const tv = outcomeLegTvTickers(o, q, tmplIndex);
    out.push({
      id: "outcome:" + id + ":0",
      kind: "outcome",
      coin: yesCoin,
      noCoin,
      yesTvCoin: tv.yes,
      noTvCoin: tv.no,
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
      underlyingKey: undKey,
      underlyingPx: lookupUnderlyingPx(undKey, px, hip3Marks),
      expiryMs: parseOutcomeExpiryMs(fields),
      noMarkPx: noPx,
    });
  });
  return out;
}
