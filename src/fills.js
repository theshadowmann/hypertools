import { fmtQty, num } from "./format.js";
import { isOutcomeCoin } from "./outcomes.js";
import { tradeHashHref } from "./book.js";

const BUY_DIRS = new Set([
  "Open Long",
  "Close Short",
  "Buy",
  "Short > Long",
]);
const SELL_DIRS = new Set([
  "Close Long",
  "Open Short",
  "Sell",
  "Long > Short",
]);

/** HL-style timestamp: M/D/YYYY - HH:MM:SS (local). */
export function formatFillTime(ms) {
  const n = num(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (x) => String(x).padStart(2, "0");
  return (
    d.getMonth() +
    1 +
    "/" +
    d.getDate() +
    "/" +
    d.getFullYear() +
    " - " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

/** Prefer API `dir`; else derive Open/Close Long/Short or Buy/Sell. */
export function fillDirectionLabel(fill, { outcome = false } = {}) {
  if (!fill || typeof fill !== "object") return "—";
  const raw = fill.dir != null ? String(fill.dir).trim() : "";
  if (raw) return raw;
  if (outcome) return fill.side === "B" ? "Buy" : fill.side === "A" ? "Sell" : "—";
  const side = fill.side;
  const start = num(fill.startPosition);
  if (side === "B") {
    if (Number.isFinite(start) && start < 0) return "Close Short";
    return "Open Long";
  }
  if (side === "A") {
    if (Number.isFinite(start) && start > 0) return "Close Long";
    return "Open Short";
  }
  return "—";
}

/** Teal for open-long / close-short / buy; red for close-long / open-short / sell. */
export function fillDirectionClass(dir) {
  const d = String(dir || "");
  if (BUY_DIRS.has(d) || /^Buy\b/i.test(d)) return "text-buy";
  if (SELL_DIRS.has(d) || /^Sell\b/i.test(d)) return "text-sell";
  if (/Long/i.test(d) && /Open/i.test(d)) return "text-buy";
  if (/Short/i.test(d) && /Close/i.test(d)) return "text-buy";
  if (/Long/i.test(d) && /Close/i.test(d)) return "text-sell";
  if (/Short/i.test(d) && /Open/i.test(d)) return "text-sell";
  return "";
}

/** Amount with USDC suffix (HL Trade History style). */
export function fmtUsdcAmt(raw, opts = {}) {
  if (raw == null || raw === "") return "—";
  const n = num(raw);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  // HL Trade History: 2dp for typical fee/pnl/value; more digits only for dust.
  const digits = abs === 0 ? 2 : abs >= 0.01 ? 2 : abs >= 0.0001 ? 4 : 6;
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  let sign = "";
  if (opts.signed) {
    if (n > 0) sign = "+";
    else if (n < 0) sign = "-";
  } else if (n < 0) {
    sign = "-";
  }
  return sign + body + " USDC";
}

export function fillTradeValue(fill) {
  const px = num(fill && fill.px);
  const sz = num(fill && fill.sz);
  if (!Number.isFinite(px) || !Number.isFinite(sz)) return NaN;
  return px * sz;
}

/** /trade → non-outcome fills; /outcome → outcome fills only. Portfolio shows all. */
export function filterFillsByPage(fills, pageKind) {
  const rows = Array.isArray(fills) ? fills : [];
  if (pageKind === "outcome") return rows.filter((f) => isOutcomeCoin(f && f.coin));
  if (pageKind === "trade") return rows.filter((f) => !isOutcomeCoin(f && f.coin));
  return rows.slice();
}

export function sortFillsByTimeDesc(fills) {
  return (Array.isArray(fills) ? fills.slice() : []).sort((a, b) => num(b && b.time) - num(a && a.time));
}

/**
 * Build HL-style Trade History table.
 * @param {typeof import("./dom.js").h} h
 * @param {object[]} fills
 * @param {{ marketLabel?: (f: object) => string, outcome?: boolean }} [opts]
 */
export function buildTradeHistoryTable(h, fills, opts = {}) {
  const headers = ["Time", "Market", "Direction", "Price", "Size", "Trade Value", "Fee", "Closed PNL"];
  const rows = sortFillsByTimeDesc(fills).slice(0, 100).map((f) => {
    const dir = fillDirectionLabel(f, { outcome: !!opts.outcome });
    const dirCls = fillDirectionClass(dir);
    const coin = f && f.coin != null ? String(f.coin) : "—";
    const market = opts.marketLabel ? opts.marketLabel(f) : coin;
    const href = tradeHashHref(f && f.hash);
    const timeKids = [formatFillTime(f && f.time)];
    if (href) {
      timeKids.push(
        h(
          "a",
          {
            class: "hash ml-1 text-accent",
            href,
            target: "_blank",
            rel: "noopener noreferrer",
            title: "Explorer",
          },
          "↗"
        )
      );
    }
    const px = num(f && f.px);
    const pxStr = Number.isFinite(px)
      ? px.toLocaleString("en-US", {
          minimumFractionDigits: px >= 1000 ? 2 : px >= 1 ? 2 : px >= 0.01 ? 4 : 6,
          maximumFractionDigits: px >= 1000 ? 2 : px >= 1 ? 2 : px >= 0.01 ? 4 : 6,
        })
      : "—";
    const sizeLabel =
      f && f.sz != null && coin !== "—" ? fmtQty(f.sz) + " " + coin : "—";
    const pnl = f && f.closedPnl;
    const pnlN = num(pnl);
    const pnlCls =
      !Number.isFinite(pnlN) || pnlN === 0 ? "text-white" : pnlN > 0 ? "text-success" : "text-danger";
    return h(
      "tr",
      null,
      h("td", { class: "px-2 py-1.5 text-mist-400 whitespace-nowrap" }, ...timeKids),
      h("td", { class: "px-2 py-1.5 " + (dirCls || "text-white") }, market),
      h("td", { class: "px-2 py-1.5 " + (dirCls || "") }, dir),
      h("td", { class: "px-2 py-1.5 font-mono" }, pxStr),
      h("td", { class: "px-2 py-1.5 font-mono" }, sizeLabel),
      h("td", { class: "px-2 py-1.5 font-mono" }, fmtUsdcAmt(fillTradeValue(f))),
      h("td", { class: "px-2 py-1.5 font-mono" }, f && f.fee != null ? fmtUsdcAmt(f.fee) : "—"),
      h(
        "td",
        { class: "px-2 py-1.5 font-mono " + pnlCls },
        pnl != null && Number.isFinite(pnlN) ? fmtUsdcAmt(pnl, { signed: true }) : "—"
      )
    );
  });
  return h(
    "div",
    { class: "overflow-x-auto" },
    h(
      "table",
      { class: "bal-table" },
      h("thead", null, h("tr", null, ...headers.map((label) => h("th", null, label)))),
      h("tbody", null, ...rows)
    )
  );
}
