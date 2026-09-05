/**
 * Outcome position Limit / Market close — Hyperliquid-style overlay, not a ticket jump.
 * Sell the held Yes/No share token. Size is integer shares (HIP-4 szDecimals 0).
 */
import { formatPnlPct } from "./balances.js";
import { clear, h } from "./dom.js";
import { fmtPx, fmtQty, fmtUsd, num } from "./format.js";
import {
  enableTrading,
  placePerpOrder,
  tradingStatus,
  userMessage,
} from "./hl-trade.js";
import { assertCanTrade } from "./order-build.js";
import {
  outcomeLegAsset,
  outcomePositionMetrics,
} from "./outcomes.js";
import { paintRangeFill } from "./range-fill.js";
import { DEFAULT_MAX_SLIPPAGE } from "./ticket-math.js";

export const SKIP_MARKET_CLOSE_KEY = "ht-skip-outcome-market-close";
export const OUTCOME_CLOSE_MODAL_ID = "ht-out-close-modal";
export const LIMIT_CLOSE_TIP = "Close at a limit price";

export const OUTCOME_POS_HEADERS = [
  "Market",
  "Size",
  "Available Size",
  "Position Value",
  "Entry Price",
  "Mark Price",
  "PNL (ROE %)",
];

let getApp = () => null;
let closeBusy = false;
let closeBusyCoin = "";
let activeOpts = null;

export function bindOutcomeCloseApp(fn) {
  getApp = typeof fn === "function" ? fn : () => null;
}

export function isOutcomeCloseBusy() {
  return closeBusy;
}

export function outcomeCloseBusyCoin() {
  return closeBusyCoin;
}

export function skipMarketCloseModal(storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store || typeof store.getItem !== "function") return false;
  try {
    return store.getItem(SKIP_MARKET_CLOSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipMarketCloseModal(on, storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return;
  try {
    if (on) store.setItem(SKIP_MARKET_CLOSE_KEY, "1");
    else store.removeItem(SKIP_MARKET_CLOSE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function outcomeSideName(row) {
  return row && String(row.side).toLowerCase() === "no" ? "No" : "Yes";
}

export function outcomeSizeLabel(row, formatQty) {
  const fmt = typeof formatQty === "function" ? formatQty : (n) => String(n);
  const qty = fmt(row && row.total);
  return qty + " " + outcomeSideName(row);
}

export function outcomeCloseLeg(row) {
  return outcomeSideName(row) === "No" ? 1 : 0;
}

/** Integer shares from a 0–100 percent of available. */
export function closeSharesFromPct(available, pct) {
  const a = Number(available);
  const p = Number(pct);
  if (!Number.isFinite(a) || a <= 0) return 0;
  const frac = Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0)) / 100;
  return Math.max(0, Math.min(Math.floor(a + 1e-9), Math.round(a * frac)));
}

export function pctFromShares(shares, available) {
  const a = Number(available);
  const s = Number(shares);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(s)) return 0;
  return Math.max(0, Math.min(100, Math.round((s / a) * 100)));
}

export function closeNotional(shares, px) {
  const s = Number(shares);
  const p = Number(px);
  if (!Number.isFinite(s) || !Number.isFinite(p) || p <= 0) return NaN;
  return s * p;
}

export function sharesFromNotional(usdc, px, available) {
  const u = Number(usdc);
  const p = Number(px);
  if (!Number.isFinite(u) || u < 0 || !Number.isFinite(p) || p <= 0) return 0;
  const raw = Math.round(u / p);
  const cap = Number(available);
  const hi = Number.isFinite(cap) && cap >= 0 ? Math.floor(cap + 1e-9) : raw;
  return Math.max(0, Math.min(hi, raw));
}

export function marketForOutcomeRow(row, markets) {
  if (!row) return null;
  const list = markets || [];
  if (row.marketId) {
    const byId = list.find((m) => m && m.id === row.marketId);
    if (byId) return byId;
  }
  const c = String(row.coin || "");
  const hash = c.charAt(0) === "+" ? "#" + c.slice(1) : c;
  return (
    list.find(
      (m) =>
        m &&
        m.kind === "outcome" &&
        (m.balanceCoin === c ||
          m.noBalanceCoin === c ||
          m.coin === c ||
          m.noCoin === c ||
          m.coin === hash ||
          m.noCoin === hash)
    ) || null
  );
}

export function refClosePx(row, kind, limitPx) {
  if (kind === "limit") {
    const p = Number(limitPx);
    if (Number.isFinite(p) && p > 0) return p;
  }
  const mark = Number(row && row.markPx);
  return Number.isFinite(mark) && mark > 0 ? mark : NaN;
}

function session() {
  const app = getApp && getApp();
  const state = (app && app.state) || {};
  return {
    app,
    source: state.source,
    address: state.address,
    provider: state.provider,
    markets: state.markets || [],
  };
}

export function canCloseOutcomes(state) {
  const s = state || session();
  return s.source === "wallet" && !!s.provider && !!s.address;
}

function toast(msg, kind) {
  const app = getApp && getApp();
  if (app && typeof app.setStatus === "function") app.setStatus(msg, kind);
  const ticket = typeof document !== "undefined" ? document.getElementById("ticket-status") : null;
  if (ticket) {
    ticket.textContent = msg || "";
    ticket.classList.toggle("err", kind === "err");
    ticket.classList.toggle("ok", kind === "ok");
  }
  if (typeof document === "undefined") return;
  let el = document.getElementById("ht-out-close-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ht-out-close-toast";
    el.className = "out-close-toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg || "";
  el.classList.toggle("err", kind === "err");
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("is-on", !!msg);
  clearTimeout(el._htT);
  if (msg) {
    el._htT = setTimeout(() => {
      el.classList.remove("is-on");
    }, 4200);
  }
}

function reduceOnlyRejected(err) {
  return /reduce.?only/i.test(String((err && err.message) || err || ""));
}

export async function submitOutcomeClose({
  kind,
  row,
  shares,
  price,
  markets,
  skipAgain,
  onStatus,
} = {}) {
  const sess = session();
  assertCanTrade(sess.source);
  const sz = Math.floor(Number(shares) + 1e-9);
  if (!Number.isFinite(sz) || sz <= 0) throw new Error("Enter a size greater than zero");
  const list = markets && markets.length ? markets : sess.markets;
  const mkt = marketForOutcomeRow(row, list);
  if (!mkt) throw new Error("Unknown outcome market");
  const asset = outcomeLegAsset(mkt, outcomeCloseLeg(row));
  if (!Number.isInteger(asset)) throw new Error("Unknown outcome market");
  const mark = Number(row && row.markPx);
  const mid = Number.isFinite(mark) && mark > 0 ? mark : Number(price);
  const isMkt = kind === "market";
  const px = isMkt ? mid : Number(price);
  if (!isMkt && !(Number.isFinite(px) && px > 0)) throw new Error("Enter a limit price");
  if (isMkt && skipAgain) setSkipMarketCloseModal(true);

  const status = onStatus || ((s) => toast(s));
  const ready = await tradingStatus(sess.address).catch(() => ({ feeOk: false, agentOk: false }));
  if (!ready.feeOk || !ready.agentOk) {
    await enableTrading({
      provider: sess.provider,
      address: sess.address,
      onStatus: status,
    });
  }

  const args = {
    source: sess.source,
    address: sess.address,
    market: mkt,
    side: "sell",
    size: sz,
    mid,
    price: px,
    type: isMkt ? "market" : "limit",
    tif: isMkt ? "Ioc" : "Gtc",
    reduceOnly: true,
    maxSlippage: DEFAULT_MAX_SLIPPAGE,
    asset,
    onStatus: status,
  };
  try {
    await placePerpOrder(args);
  } catch (err) {
    if (!reduceOnlyRejected(err)) throw err;
    await placePerpOrder({ ...args, reduceOnly: false });
  }
}

export function isOutcomeCloseModalOpen() {
  const el = typeof document !== "undefined" ? document.getElementById(OUTCOME_CLOSE_MODAL_ID) : null;
  return !!(el && el.classList.contains("is-open"));
}

export function closeOutcomeCloseModal() {
  const overlay = typeof document !== "undefined" ? document.getElementById(OUTCOME_CLOSE_MODAL_ID) : null;
  if (overlay) overlay.classList.remove("is-open");
  activeOpts = null;
}

function ensureModal() {
  if (typeof document === "undefined") return null;
  let overlay = document.getElementById(OUTCOME_CLOSE_MODAL_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = OUTCOME_CLOSE_MODAL_ID;
  overlay.className = "out-close-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "out-close-title");
  const panel = document.createElement("div");
  panel.className = "out-close-panel";
  panel.setAttribute("data-ht-panel", "1");
  overlay.appendChild(panel);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeOutcomeCloseModal();
  });
  if (!document._htOutCloseEsc) {
    document._htOutCloseEsc = true;
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && isOutcomeCloseModalOpen()) closeOutcomeCloseModal();
    });
  }
  document.body.appendChild(overlay);
  return overlay;
}

function paintModal(overlay, opts) {
  const kind = opts.kind === "market" ? "market" : "limit";
  const row = opts.row || {};
  const available = Math.max(0, Number(row.available));
  const mark = Number(row.markPx);
  let unit = "usdc";
  let shares = closeSharesFromPct(available, 100);
  let limitPx = Number.isFinite(mark) && mark > 0 ? mark : "";
  let skipAgain = false;
  const panel = overlay.querySelector(".out-close-panel");
  clear(panel);

  const x = h(
    "button",
    { type: "button", class: "out-close-x", "aria-label": "Close", onClick: () => closeOutcomeCloseModal() },
    "×"
  );
  const title = h("h2", { id: "out-close-title", class: "out-close-title" }, kind === "market" ? "Market Close" : "Limit Close");
  const sub = h(
    "p",
    { class: "out-close-sub" },
    kind === "market"
      ? "This will attempt to immediately close the position."
      : "This will send an order to close your position at the limit price."
  );

  const status = h("p", { class: "out-close-status", id: "out-close-status", role: "status" });

  const sizeInput = h("input", {
    id: "out-close-size",
    class: "out-close-input",
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    "aria-label": "Size",
  });
  const unitBtn = h("button", { type: "button", class: "out-close-unit", id: "out-close-unit" });
  const range = h("input", {
    id: "out-close-pct",
    class: "pct-slider out-close-pct",
    type: "range",
    min: "0",
    max: "100",
    step: "1",
    value: "100",
  });
  const ticks = h("div", { class: "pct-ticks out-close-ticks", "aria-hidden": "true" }, h("span"), h("span"), h("span"), h("span"), h("span"));
  const pctBox = h("input", {
    id: "out-close-pct-box",
    class: "pct-box",
    type: "text",
    inputmode: "numeric",
    value: "100",
    "aria-label": "Percent of available",
  });

  const priceInput = h("input", {
    id: "out-close-price",
    class: "out-close-input",
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    "aria-label": "Price (USDC)",
    value: limitPx === "" ? "" : String(limitPx),
  });

  function pxNow() {
    if (kind === "limit") {
      const p = num(priceInput.value);
      if (Number.isFinite(p) && p > 0) return p;
    }
    return Number.isFinite(mark) && mark > 0 ? mark : NaN;
  }

  function renderSizeField() {
    const px = pxNow();
    const notion = closeNotional(shares, px);
    if (unit === "usdc") {
      sizeInput.value = Number.isFinite(notion)
        ? notion.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
        : "";
    } else {
      sizeInput.value = String(shares);
    }
    unitBtn.textContent = unit === "usdc" ? "USDC" : outcomeSideName(row);
    unitBtn.appendChild(h("span", { class: "out-close-chev" }, "▾"));
  }

  function renderPct() {
    const pct = pctFromShares(shares, available);
    range.value = String(pct);
    pctBox.value = String(pct);
    paintRangeFill(range, ticks);
  }

  function setShares(next) {
    const cap = Math.floor(available + 1e-9);
    shares = Math.max(0, Math.min(cap, Math.round(Number(next) || 0)));
    renderSizeField();
    renderPct();
  }

  unitBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    unit = unit === "usdc" ? "coin" : "usdc";
    renderSizeField();
  });

  sizeInput.addEventListener("input", () => {
    const raw = num(sizeInput.value.replace(/,/g, ""));
    if (unit === "usdc") setShares(sharesFromNotional(raw, pxNow(), available));
    else setShares(raw);
  });

  range.addEventListener("input", () => {
    setShares(closeSharesFromPct(available, num(range.value)));
  });
  pctBox.addEventListener("change", () => {
    setShares(closeSharesFromPct(available, num(pctBox.value)));
  });
  pctBox.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      setShares(closeSharesFromPct(available, num(pctBox.value)));
    }
  });

  if (kind === "limit") {
    priceInput.addEventListener("input", () => renderSizeField());
  }

  const slider = h(
    "div",
    { class: "slider-row out-close-slider" },
    range,
    ticks,
    pctBox,
    h("span", { class: "pct-suffix" }, "%")
  );

  const submit = h(
    "button",
    { type: "button", class: "out-close-submit", id: "out-close-submit" },
    kind === "market" ? "Market Close" : "Confirm"
  );

  async function onConfirm() {
    if (closeBusy) return;
    const sess = session();
    if (!canCloseOutcomes(sess)) {
      closeOutcomeCloseModal();
      sess.app && sess.app.connectFromNav && sess.app.connectFromNav();
      return;
    }
    closeBusy = true;
    closeBusyCoin = String(row.coin || "");
    submit.disabled = true;
    status.textContent = "";
    status.classList.remove("err", "ok");
    try {
      await submitOutcomeClose({
        kind,
        row,
        shares,
        price: pxNow(),
        markets: opts.markets,
        skipAgain: kind === "market" && skipAgain,
        onStatus: (s) => {
          status.textContent = s || "";
          toast(s);
        },
      });
      closeOutcomeCloseModal();
      toast("Close order accepted.", "ok");
      if (typeof opts.onSuccess === "function") await opts.onSuccess();
      const app = sess.app;
      if (app && typeof app.reloadAccount === "function") app.reloadAccount();
    } catch (err) {
      const msg = userMessage(err);
      status.textContent = msg;
      status.classList.add("err");
      toast(msg, "err");
    } finally {
      closeBusy = false;
      closeBusyCoin = "";
      submit.disabled = false;
      if (typeof opts.onSettled === "function") opts.onSettled();
    }
  }
  submit.addEventListener("click", onConfirm);

  panel.appendChild(x);
  panel.appendChild(title);
  panel.appendChild(sub);

  if (kind === "market") {
    panel.appendChild(
      h(
        "div",
        { class: "out-close-kv" },
        h("span", { class: "out-close-k" }, "Size"),
        h("span", { class: "out-close-v out-close-coral" }, outcomeSizeLabel(row, fmtQty))
      )
    );
    panel.appendChild(
      h(
        "div",
        { class: "out-close-kv" },
        h("span", { class: "out-close-k" }, "Price"),
        h("span", { class: "out-close-v" }, "Market")
      )
    );
  } else {
    const midBtn = h("button", { type: "button", class: "out-close-mid" }, "Mid");
    midBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (Number.isFinite(mark) && mark > 0) {
        priceInput.value = String(mark);
        renderSizeField();
      }
    });
    panel.appendChild(
      h(
        "div",
        { class: "out-close-price-row" },
        h(
          "div",
          { class: "out-close-field" },
          h("span", { class: "out-close-field-k" }, "Price (USDC)"),
          priceInput,
          midBtn
        ),
        h("button", { type: "button", class: "out-close-tif", disabled: true }, "Limit", h("span", { class: "out-close-chev" }, "▾"))
      )
    );
  }

  panel.appendChild(
    h(
      "div",
      { class: "out-close-field" },
      h("span", { class: "out-close-field-k" }, "Size"),
      sizeInput,
      unitBtn
    )
  );
  panel.appendChild(slider);

  if (kind === "market") {
    const skip = h("input", { type: "checkbox", id: "out-close-skip" });
    skip.addEventListener("change", () => {
      skipAgain = !!skip.checked;
    });
    panel.appendChild(
      h(
        "label",
        { class: "out-close-skip", for: "out-close-skip" },
        skip,
        h("span", null, "Don't show this again")
      )
    );
  }

  panel.appendChild(submit);
  panel.appendChild(status);
  setShares(closeSharesFromPct(available, 100));
}

export function openOutcomeCloseModal(opts) {
  const overlay = ensureModal();
  if (!overlay) return null;
  activeOpts = opts || {};
  paintModal(overlay, activeOpts);
  overlay.classList.add("is-open");
  const range = overlay.querySelector("#out-close-pct");
  const ticks = overlay.querySelector(".out-close-ticks");
  paintRangeFill(range, ticks);
  const focusId = activeOpts.kind === "market" ? "out-close-size" : "out-close-price";
  const focus = overlay.querySelector("#" + focusId);
  if (focus && typeof focus.focus === "function") {
    focus.focus();
    if (typeof focus.select === "function") focus.select();
  }
  return overlay;
}

/**
 * Limit → always the modal. Market → modal unless "Don't show this again" is set,
 * in which case place immediately at 100% available.
 */
export async function startOutcomeClose(opts) {
  const kind = opts && opts.kind === "market" ? "market" : "limit";
  const sess = session();
  if (!canCloseOutcomes(sess)) {
    if (sess.app && sess.app.connectFromNav) sess.app.connectFromNav();
    else toast("Connect a wallet to place orders.", "err");
    return { opened: false };
  }
  if (kind === "market" && skipMarketCloseModal()) {
    const row = opts.row || {};
    const shares = closeSharesFromPct(row.available, 100);
    closeBusy = true;
    closeBusyCoin = String(row.coin || "");
    if (typeof opts.onSettled === "function") opts.onSettled();
    try {
      await submitOutcomeClose({
        kind: "market",
        row,
        shares,
        price: Number(row.markPx),
        markets: opts.markets,
        onStatus: (s) => toast(s),
      });
      toast("Close order accepted.", "ok");
      if (typeof opts.onSuccess === "function") await opts.onSuccess();
      if (sess.app && typeof sess.app.reloadAccount === "function") sess.app.reloadAccount();
    } catch (err) {
      toast(userMessage(err), "err");
    } finally {
      closeBusy = false;
      closeBusyCoin = "";
      if (typeof opts.onSettled === "function") opts.onSettled();
    }
    return { opened: false, skipped: true };
  }
  openOutcomeCloseModal(opts);
  return { opened: true };
}

export function buildOutcomePositionsTable(rows, opts = {}) {
  const showClose = !!opts.showClose;
  const busy = !!opts.closeBusy;
  const busyCoin = opts.closeBusyCoin || "";
  const empty = opts.emptyMessage || "No outcomes yet";
  const onTitle = opts.onTitleClick;
  const list = rows || [];
  const colSpan = String(OUTCOME_POS_HEADERS.length + (showClose ? 1 : 0));
  const head = h(
    "thead",
    null,
    h(
      "tr",
      null,
      ...OUTCOME_POS_HEADERS.map((label) => h("th", null, label)),
      showClose ? h("th", { class: "orders-cancel-h" }, "") : null
    )
  );
  if (!list.length) {
    return h(
      "table",
      { class: "bal-table out-table" },
      head,
      h("tbody", null, h("tr", null, h("td", { colSpan, class: "out-empty" }, empty)))
    );
  }
  const body = list.map((p) => {
    const m = outcomePositionMetrics(p);
    const pnlTxt =
      m.pnlPct == null && !Number.isFinite(m.pnlUsd)
        ? "—"
        : (Number.isFinite(m.pnlUsd) ? fmtUsd(m.pnlUsd, { signed: true }) : "—") +
          " (" +
          formatPnlPct(m.pnlPct) +
          ")";
    const pnlCls =
      m.pnlPct == null || !Number.isFinite(m.pnlPct) || m.pnlPct === 0
        ? ""
        : m.pnlPct > 0
          ? " up"
          : " down";
    const rowBusy = busy || (busyCoin && busyCoin === p.coin);
    const titleBtn = h(
      onTitle ? "button" : "span",
      onTitle
        ? {
            type: "button",
            class: "out-mkt-btn",
            onClick: () => onTitle(p),
          }
        : { class: "out-mkt-btn" },
      p.title || p.coin || "—"
    );
    const actions = showClose
      ? h(
          "td",
          { class: "orders-cancel-cell out-close-cell" },
          h(
            "button",
            {
              type: "button",
              class: "orders-cancel out-close",
              title: LIMIT_CLOSE_TIP,
              disabled: rowBusy,
              onClick: (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof opts.onLimit === "function") opts.onLimit(p);
              },
            },
            "Limit"
          ),
          h(
            "button",
            {
              type: "button",
              class: "orders-cancel out-close",
              disabled: rowBusy,
              onClick: (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof opts.onMarket === "function") opts.onMarket(p);
              },
            },
            "Market"
          )
        )
      : null;
    return h(
      "tr",
      null,
      h("td", null, titleBtn),
      h(
        "td",
        { class: "out-size" },
        h("span", { class: "out-size-qty" }, fmtQty(p.total)),
        " ",
        h("span", { class: "out-size-side" }, outcomeSideName(p))
      ),
      h("td", null, fmtQty(p.available)),
      h("td", null, Number.isFinite(m.value) ? fmtUsd(m.value) : "—"),
      h("td", null, Number.isFinite(m.entryPx) ? fmtPx(m.entryPx) : "—"),
      h("td", null, p.markPx == null ? "—" : fmtPx(p.markPx)),
      h("td", { class: "bal-pnl" + pnlCls }, pnlTxt),
      actions
    );
  });
  return h("table", { class: "bal-table out-table" }, head, h("tbody", null, ...body));
}
