/**
 * Perp position Limit / Market close — Hyperliquid-style overlay (match outcome-close).
 * Closing a long = sell reduce-only; closing a short = buy reduce-only.
 */
import { clear, h } from "./dom.js";
import { fmtPx, fmtQty, fmtUsd, num } from "./format.js";
import { getAgent } from "./agent-store.js";
import {
  enableTrading,
  placePerpOrder,
  tradingStatus,
  userMessage,
} from "./hl-trade.js";
import { assertCanTrade, roundSz } from "./order-build.js";
import { paintRangeFill } from "./range-fill.js";
import { DEFAULT_MAX_SLIPPAGE } from "./ticket-math.js";

export const SKIP_PERP_MARKET_CLOSE_KEY = "ht-skip-perp-market-close";
export const PERP_CLOSE_MODAL_ID = "ht-perp-close-modal";
export const PERP_CLOSE_ALL_MODAL_ID = "ht-perp-close-all-modal";
export const LIMIT_CLOSE_TIP = "Close at a limit price";
export const CLOSE_ALL_GAP_MS = 550;

let getApp = () => null;
let closeBusy = false;
let closeBusyCoin = "";
let closeAllBusy = false;
let activeOpts = null;

export function bindPerpCloseApp(fn) {
  getApp = typeof fn === "function" ? fn : () => null;
}

export function isPerpCloseBusy() {
  return closeBusy || closeAllBusy;
}

export function perpCloseBusyCoin() {
  return closeBusyCoin;
}

export function isPerpCloseAllBusy() {
  return closeAllBusy;
}

export function skipPerpMarketCloseModal(storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store || typeof store.getItem !== "function") return false;
  try {
    return store.getItem(SKIP_PERP_MARKET_CLOSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipPerpMarketCloseModal(on, storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return;
  try {
    if (on) store.setItem(SKIP_PERP_MARKET_CLOSE_KEY, "1");
    else store.removeItem(SKIP_PERP_MARKET_CLOSE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Positive size held; longs have szi > 0. */
export function positionAbsSize(row) {
  const szi = Number(row && row.szi);
  if (!Number.isFinite(szi) || szi === 0) return 0;
  return Math.abs(szi);
}

export function positionIsLong(row) {
  const szi = Number(row && row.szi);
  return Number.isFinite(szi) && szi >= 0;
}

/** Closing a long sells; closing a short buys. */
export function closeSideForPosition(row) {
  return positionIsLong(row) ? "sell" : "buy";
}

export function marketForPerpRow(row, markets) {
  if (!row) return null;
  const coin = String(row.coin || "");
  if (!coin) return null;
  const list = markets || [];
  return (
    list.find((m) => m && m.kind === "perp" && m.coin === coin) ||
    list.find((m) => m && m.coin === coin && m.kind !== "outcome" && m.kind !== "spot") ||
    list.find((m) => m && m.coin === coin) ||
    null
  );
}

export function midForPerpRow(row, mids, market) {
  const marks = mids || {};
  const coin = row && row.coin;
  const fromMid = coin != null ? Number(marks[coin]) : NaN;
  if (Number.isFinite(fromMid) && fromMid > 0) return fromMid;
  const fromMktMid = market != null ? Number(market.midPx) : NaN;
  if (Number.isFinite(fromMktMid) && fromMktMid > 0) return fromMktMid;
  const fromMktMark = market != null ? Number(market.markPx) : NaN;
  if (Number.isFinite(fromMktMark) && fromMktMark > 0) return fromMktMark;
  const entry = Number(row && row.entryPx);
  return Number.isFinite(entry) && entry > 0 ? entry : NaN;
}

/** Full close size in coin from position.szi (never USD display / positionValue). */
export function closeCoinSizeForRow(row, markets) {
  const abs = positionAbsSize(row);
  if (!(abs > 0)) return 0;
  const mkt = marketForPerpRow(row, markets);
  const szDec = mkt && mkt.szDecimals != null ? mkt.szDecimals : 5;
  return closeSizeFromPct(abs, 100, szDec);
}

/** Size in coin from a 0–100 percent of abs(szi), rounded to market decimals. */
export function closeSizeFromPct(absSize, pct, szDecimals) {
  const a = Number(absSize);
  const p = Number(pct);
  if (!Number.isFinite(a) || a <= 0) return 0;
  const frac = Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0)) / 100;
  const raw = a * frac;
  const rounded = roundSz(raw, szDecimals);
  if (!Number.isFinite(rounded) || rounded <= 0) return 0;
  return Math.min(a, rounded);
}

export function pctFromCloseSize(size, absSize) {
  const a = Number(absSize);
  const s = Number(size);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(s)) return 0;
  return Math.max(0, Math.min(100, Math.round((s / a) * 100)));
}

export function closeNotional(size, px) {
  const s = Number(size);
  const p = Number(px);
  if (!Number.isFinite(s) || !Number.isFinite(p) || p <= 0) return NaN;
  return s * p;
}

export function sizeFromNotional(usdc, px, absSize, szDecimals) {
  const u = Number(usdc);
  const p = Number(px);
  if (!Number.isFinite(u) || u < 0 || !Number.isFinite(p) || p <= 0) return 0;
  const raw = roundSz(u / p, szDecimals);
  const cap = Number(absSize);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (Number.isFinite(cap) && cap >= 0) return Math.min(cap, raw);
  return raw;
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
    mids: (state.data && state.data.mids) || {},
  };
}

/** Wallet-connected trading only — pasted addresses stay read-only. */
export function canClosePerps(state) {
  const s = state || session();
  return s.source === "wallet" && !!s.provider && !!s.address;
}

/** Ensure agent exists; skip Info tradingStatus when session agent is already present. */
async function ensureCloseTrading(onStatus) {
  const sess = session();
  if (getAgent(sess.address)) return;
  const ready = await tradingStatus(sess.address).catch(() => ({ feeOk: false, agentOk: false }));
  if (!ready.feeOk || !ready.agentOk) {
    await enableTrading({
      provider: sess.provider,
      address: sess.address,
      onStatus,
    });
  }
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
  let el = document.getElementById("ht-perp-close-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ht-perp-close-toast";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitPerpClose({
  kind,
  row,
  size,
  price,
  markets,
  mids,
  skipAgain,
  onStatus,
} = {}) {
  const sess = session();
  assertCanTrade(sess.source);
  const list = markets && markets.length ? markets : sess.markets;
  const mkt = marketForPerpRow(row, list);
  if (!mkt) throw new Error("Unknown perp market");
  const abs = positionAbsSize(row);
  const szDec = mkt.szDecimals != null ? mkt.szDecimals : 5;
  // Size must be coin qty from szi — never USD notional / positionValue display.
  const sz = roundSz(Number(size), szDec);
  if (!Number.isFinite(sz) || sz <= 0) throw new Error("Enter a size greater than zero");
  if (sz > abs + 1e-12) throw new Error("Size exceeds position");
  const mid = midForPerpRow(row, mids || sess.mids, mkt);
  const isMkt = kind === "market";
  const px = isMkt ? mid : Number(price);
  if (!isMkt && !(Number.isFinite(px) && px > 0)) throw new Error("Enter a limit price");
  if (isMkt && !(Number.isFinite(mid) && mid > 0)) throw new Error("No mid price for this market");
  if (isMkt && skipAgain) setSkipPerpMarketCloseModal(true);

  const status = onStatus || ((s) => toast(s));
  await ensureCloseTrading(status);

  await placePerpOrder({
    source: sess.source,
    address: sess.address,
    provider: sess.provider,
    market: mkt,
    side: closeSideForPosition(row),
    size: sz,
    mid: Number.isFinite(mid) && mid > 0 ? mid : px,
    price: px,
    type: isMkt ? "market" : "limit",
    tif: isMkt ? "Ioc" : "Gtc",
    reduceOnly: true,
    maxSlippage: DEFAULT_MAX_SLIPPAGE,
    onStatus: status,
  });
}

export function isPerpCloseModalOpen() {
  const el = typeof document !== "undefined" ? document.getElementById(PERP_CLOSE_MODAL_ID) : null;
  return !!(el && el.classList.contains("is-open"));
}

export function closePerpCloseModal() {
  const overlay = typeof document !== "undefined" ? document.getElementById(PERP_CLOSE_MODAL_ID) : null;
  if (overlay) overlay.classList.remove("is-open");
  activeOpts = null;
}

export function isPerpCloseAllModalOpen() {
  const el = typeof document !== "undefined" ? document.getElementById(PERP_CLOSE_ALL_MODAL_ID) : null;
  return !!(el && el.classList.contains("is-open"));
}

export function closePerpCloseAllModal() {
  const overlay = typeof document !== "undefined" ? document.getElementById(PERP_CLOSE_ALL_MODAL_ID) : null;
  if (overlay) overlay.classList.remove("is-open");
}

function ensureModal() {
  if (typeof document === "undefined") return null;
  let overlay = document.getElementById(PERP_CLOSE_MODAL_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = PERP_CLOSE_MODAL_ID;
  overlay.className = "out-close-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "perp-close-title");
  const panel = document.createElement("div");
  panel.className = "out-close-panel";
  panel.setAttribute("data-ht-panel", "1");
  overlay.appendChild(panel);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closePerpCloseModal();
  });
  if (!document._htPerpCloseEsc) {
    document._htPerpCloseEsc = true;
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      if (isPerpCloseAllModalOpen()) closePerpCloseAllModal();
      else if (isPerpCloseModalOpen()) closePerpCloseModal();
    });
  }
  document.body.appendChild(overlay);
  return overlay;
}

function ensureCloseAllModal() {
  if (typeof document === "undefined") return null;
  let overlay = document.getElementById(PERP_CLOSE_ALL_MODAL_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = PERP_CLOSE_ALL_MODAL_ID;
  overlay.className = "out-close-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "perp-close-all-title");
  const panel = document.createElement("div");
  panel.className = "out-close-panel";
  panel.setAttribute("data-ht-panel", "1");
  overlay.appendChild(panel);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closePerpCloseAllModal();
  });
  document.body.appendChild(overlay);
  return overlay;
}

function paintModal(overlay, opts) {
  const kind = opts.kind === "market" ? "market" : "limit";
  const row = opts.row || {};
  const coin = String(row.coin || "");
  const available = positionAbsSize(row);
  const list = opts.markets || session().markets;
  const mkt = marketForPerpRow(row, list);
  const mark = midForPerpRow(row, opts.mids, mkt);
  const szDec = mkt && mkt.szDecimals != null ? mkt.szDecimals : 5;
  let unit = "usdc";
  let size = closeSizeFromPct(available, 100, szDec);
  let skipAgain = false;
  const panel = overlay.querySelector(".out-close-panel");
  clear(panel);

  const x = h(
    "button",
    { type: "button", class: "out-close-x", "aria-label": "Close", onClick: () => closePerpCloseModal() },
    "×"
  );
  const title = h(
    "h2",
    { id: "perp-close-title", class: "out-close-title" },
    kind === "market" ? "Market Close" : "Limit Close"
  );
  const sub = h(
    "p",
    { class: "out-close-sub" },
    kind === "market"
      ? "This will attempt to immediately close the position."
      : "This will send an order to close your position at the limit price."
  );

  const status = h("p", { class: "out-close-status", id: "perp-close-status", role: "status" });

  const sizeInput = h("input", {
    id: "perp-close-size",
    class: "out-close-input",
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    "aria-label": "Size",
  });
  const unitBtn = h("button", { type: "button", class: "out-close-unit", id: "perp-close-unit" });
  const range = h("input", {
    id: "perp-close-pct",
    class: "pct-slider out-close-pct",
    type: "range",
    min: "0",
    max: "100",
    step: "1",
    value: "100",
  });
  const ticks = h(
    "div",
    { class: "pct-ticks out-close-ticks", "aria-hidden": "true" },
    h("span"),
    h("span"),
    h("span"),
    h("span"),
    h("span")
  );
  const pctBox = h("input", {
    id: "perp-close-pct-box",
    class: "pct-box",
    type: "text",
    inputmode: "numeric",
    value: "100",
    "aria-label": "Percent of position",
  });

  const priceInput = h("input", {
    id: "perp-close-price",
    class: "out-close-input",
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    "aria-label": "Price (USDC)",
    value: Number.isFinite(mark) && mark > 0 ? String(mark) : "",
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
    const notion = closeNotional(size, px);
    if (unit === "usdc") {
      sizeInput.value = Number.isFinite(notion)
        ? notion.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
        : "";
    } else {
      sizeInput.value = String(size);
    }
    unitBtn.textContent = unit === "usdc" ? "USDC" : coin || "Coin";
    unitBtn.appendChild(h("span", { class: "out-close-chev" }, "▾"));
  }

  function renderPct() {
    const pct = pctFromCloseSize(size, available);
    range.value = String(pct);
    pctBox.value = String(pct);
    paintRangeFill(range, ticks);
  }

  function setSize(next) {
    const raw = Number(next);
    const rounded = roundSz(Number.isFinite(raw) ? raw : 0, szDec);
    size = Math.max(0, Math.min(available, Number.isFinite(rounded) ? rounded : 0));
    renderSizeField();
    renderPct();
  }

  unitBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    unit = unit === "usdc" ? "coin" : "usdc";
    renderSizeField();
  });

  sizeInput.addEventListener("input", () => {
    const raw = num(String(sizeInput.value).replace(/,/g, ""));
    if (unit === "usdc") setSize(sizeFromNotional(raw, pxNow(), available, szDec));
    else setSize(raw);
  });

  range.addEventListener("input", () => {
    setSize(closeSizeFromPct(available, num(range.value), szDec));
  });
  pctBox.addEventListener("change", () => {
    setSize(closeSizeFromPct(available, num(pctBox.value), szDec));
  });
  pctBox.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      setSize(closeSizeFromPct(available, num(pctBox.value), szDec));
    }
  });

  if (kind === "limit") {
    priceInput.addEventListener("input", () => renderSizeField());
  }

  const slider = h(
    "div",
    { class: "slider-row out-close-slider" },
    h("div", { class: "slider-track-wrap" }, range, ticks),
    pctBox,
    h("span", { class: "pct-suffix" }, "%")
  );

  const submit = h(
    "button",
    { type: "button", class: "out-close-submit", id: "perp-close-submit" },
    kind === "market" ? "Market Close" : "Confirm"
  );

  async function onConfirm() {
    if (closeBusy || closeAllBusy) return;
    const sess = session();
    if (!canClosePerps(sess)) {
      closePerpCloseModal();
      sess.app && sess.app.connectFromNav && sess.app.connectFromNav();
      return;
    }
    closeBusy = true;
    closeBusyCoin = coin;
    submit.disabled = true;
    status.textContent = "";
    status.classList.remove("err", "ok");
    try {
      await submitPerpClose({
        kind,
        row,
        size,
        price: pxNow(),
        markets: opts.markets,
        mids: opts.mids,
        skipAgain: kind === "market" && skipAgain,
        onStatus: (s) => {
          status.textContent = s || "";
          toast(s);
        },
      });
      closePerpCloseModal();
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

  const sizeLabel = fmtQty(available) + (coin ? " " + coin : "");

  if (kind === "market") {
    panel.appendChild(
      h(
        "div",
        { class: "out-close-kv" },
        h("span", { class: "out-close-k" }, "Size"),
        h("span", { class: "out-close-v out-close-coral" }, sizeLabel)
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
        h(
          "button",
          { type: "button", class: "out-close-tif", disabled: true },
          "Limit",
          h("span", { class: "out-close-chev" }, "▾")
        )
      )
    );
  }

  panel.appendChild(
    h("div", { class: "out-close-field" }, h("span", { class: "out-close-field-k" }, "Size"), sizeInput, unitBtn)
  );
  panel.appendChild(slider);

  if (kind === "market") {
    const skip = h("input", { type: "checkbox", id: "perp-close-skip" });
    skip.addEventListener("change", () => {
      skipAgain = !!skip.checked;
    });
    panel.appendChild(
      h("label", { class: "out-close-skip", for: "perp-close-skip" }, skip, h("span", null, "Don't show this again"))
    );
  }

  panel.appendChild(submit);
  panel.appendChild(status);
  setSize(closeSizeFromPct(available, 100, szDec));
}

export function openPerpCloseModal(opts) {
  const overlay = ensureModal();
  if (!overlay) return null;
  activeOpts = opts || {};
  paintModal(overlay, activeOpts);
  overlay.classList.add("is-open");
  const range = overlay.querySelector("#perp-close-pct");
  const ticks = overlay.querySelector(".out-close-ticks");
  paintRangeFill(range, ticks);
  const focusId = activeOpts.kind === "market" ? "perp-close-size" : "perp-close-price";
  const focus = overlay.querySelector("#" + focusId);
  if (focus && typeof focus.focus === "function") {
    focus.focus();
    if (typeof focus.select === "function") focus.select();
  }
  return overlay;
}

/**
 * Limit → always the modal. Market → modal unless "Don't show this again" is set,
 * in which case place immediately at 100% of position.
 */
export async function startPerpClose(opts) {
  const kind = opts && opts.kind === "market" ? "market" : "limit";
  const sess = session();
  if (!canClosePerps(sess)) {
    if (sess.app && sess.app.connectFromNav) sess.app.connectFromNav();
    else toast("Connect a wallet to place orders.", "err");
    return { opened: false };
  }
  if (kind === "market" && skipPerpMarketCloseModal()) {
    const row = opts.row || {};
    const list = opts.markets || sess.markets;
    const mkt = marketForPerpRow(row, list);
    const size = closeCoinSizeForRow(row, list);
    closeBusy = true;
    closeBusyCoin = String(row.coin || "");
    if (typeof opts.onSettled === "function") opts.onSettled();
    try {
      await submitPerpClose({
        kind: "market",
        row,
        size,
        price: midForPerpRow(row, opts.mids || sess.mids, mkt),
        markets: opts.markets,
        mids: opts.mids,
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
  openPerpCloseModal(opts);
  return { opened: true };
}

export async function runCloseAllPerps({
  rows,
  markets,
  mids,
  gapMs,
  onStatus,
  onSuccess,
  onSettled,
} = {}) {
  const sess = session();
  assertCanTrade(sess.source);
  if (!canClosePerps(sess)) throw new Error("Connect a wallet to place orders.");
  const list = (rows || []).filter((r) => positionAbsSize(r) > 0);
  if (!list.length) throw new Error("No open perps to close.");
  const gap = Number(gapMs);
  const wait = Number.isFinite(gap) && gap >= 0 ? gap : CLOSE_ALL_GAP_MS;
  const status = onStatus || ((s) => toast(s));
  const mktList = markets && markets.length ? markets : sess.markets;
  const midMap = mids || sess.mids;

  await ensureCloseTrading(status);

  closeAllBusy = true;
  let ok = 0;
  let failed = 0;
  const failures = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      closeBusyCoin = String(row.coin || "");
      status("Closing " + (row.coin || "position") + " (" + (i + 1) + "/" + list.length + ")…");
      const size = closeCoinSizeForRow(row, mktList);
      try {
        if (!(size > 0)) throw new Error("Enter a size greater than zero");
        await submitPerpClose({
          kind: "market",
          row,
          size,
          markets: mktList,
          mids: midMap,
          onStatus: status,
        });
        ok += 1;
      } catch (err) {
        failed += 1;
        const reason = userMessage(err);
        failures.push({ coin: String(row.coin || "position"), message: reason });
        status(String(row.coin || "position") + ": " + reason);
      }
      if (i < list.length - 1) await sleep(wait);
    }
    if (failed && !ok) {
      const detail = failures.map((f) => f.coin + ": " + f.message).join("; ");
      throw new Error(detail || "Close All failed.");
    }
    const msg =
      failed > 0
        ? "Closed " +
          ok +
          " of " +
          list.length +
          " positions. Failed: " +
          failures.map((f) => f.coin + ": " + f.message).join("; ")
        : "Closed " + ok + " position" + (ok === 1 ? "" : "s") + ".";
    toast(msg, failed ? "err" : "ok");
    if (typeof onSuccess === "function") await onSuccess({ ok, failed, total: list.length, failures });
    if (sess.app && typeof sess.app.reloadAccount === "function") sess.app.reloadAccount();
    return { ok, failed, total: list.length, failures };
  } finally {
    closeAllBusy = false;
    closeBusyCoin = "";
    if (typeof onSettled === "function") onSettled();
  }
}

export function openCloseAllPerpsModal(opts) {
  const overlay = ensureCloseAllModal();
  if (!overlay) return null;
  const rows = (opts && opts.rows) || [];
  const panel = overlay.querySelector(".out-close-panel");
  clear(panel);
  const count = rows.filter((r) => positionAbsSize(r) > 0).length;
  panel.appendChild(
    h(
      "button",
      { type: "button", class: "out-close-x", "aria-label": "Close", onClick: () => closePerpCloseAllModal() },
      "×"
    )
  );
  panel.appendChild(h("h2", { id: "perp-close-all-title", class: "out-close-title" }, "Close All"));
  panel.appendChild(
    h(
      "p",
      { class: "out-close-sub" },
      "Market-close " +
        count +
        " open perp" +
        (count === 1 ? "" : "s") +
        " sequentially? This cannot be undone from this dialog."
    )
  );
  const status = h("p", { class: "out-close-status", id: "perp-close-all-status", role: "status" });
  const submit = h(
    "button",
    { type: "button", class: "out-close-submit", id: "perp-close-all-submit" },
    "Market Close All"
  );
  submit.addEventListener("click", async () => {
    if (closeBusy || closeAllBusy) return;
    const sess = session();
    if (!canClosePerps(sess)) {
      closePerpCloseAllModal();
      sess.app && sess.app.connectFromNav && sess.app.connectFromNav();
      return;
    }
    submit.disabled = true;
    status.textContent = "";
    status.classList.remove("err", "ok");
    try {
      await runCloseAllPerps({
        rows,
        markets: opts.markets,
        mids: opts.mids,
        onStatus: (s) => {
          status.textContent = s || "";
          toast(s);
        },
        onSuccess: opts.onSuccess,
        onSettled: () => {
          if (typeof opts.onSettled === "function") opts.onSettled();
        },
      });
      closePerpCloseAllModal();
    } catch (err) {
      const msg = userMessage(err);
      status.textContent = msg;
      status.classList.add("err");
      toast(msg, "err");
    } finally {
      submit.disabled = false;
    }
  });
  panel.appendChild(submit);
  panel.appendChild(status);
  overlay.classList.add("is-open");
  return overlay;
}

export async function closeAllPerps(opts) {
  const sess = session();
  if (!canClosePerps(sess)) {
    if (sess.app && sess.app.connectFromNav) sess.app.connectFromNav();
    else toast("Connect a wallet to place orders.", "err");
    return { opened: false };
  }
  openCloseAllPerpsModal(opts || {});
  return { opened: true };
}
