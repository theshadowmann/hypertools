import {
  bookLevels,
  hlInfo,
  loadDailyPrevDay,
  loadTradeExtras,
} from "./api.js";
import { clear, h, note } from "./dom.js";
import {
  fmtPx,
  fmtQty,
  fmtUsd,
  formatClock,
  formatLocalTime,
  num,
  pnlClass,
} from "./format.js";
import { levLabel, positionRows, spotUsdcParts } from "./dashboard.js";
import {
  cancelOrders,
  cancelTwap,
  enableTrading,
  placePerpOrder,
  placeScaleOrders,
  placeTwapOrder,
  setLeverage,
  tradingStatus,
  userMessage,
} from "./hl-trade.js";
import { buildOrderWire } from "./order-build.js";
import {
  buildScaleWires,
  buyingPower,
  change24h,
  coinsFromUsdc,
  DEFAULT_MAX_SLIPPAGE,
  estimateLiqPx,
  estimateSlippage,
  formatFeePct,
  formatTpslField,
  fundingCountdown,
  marginRequired,
  orderValue,
  roundPx,
  sizeFromAvailablePct,
  toWire,
  tpslMovePct,
  tpslPriceFromPct,
  tpslPriceFromUsd,
  tpslRefPx,
  tpslUsdFromPrice,
  twapMinutesFromParts,
} from "./ticket-math.js";
import { mountChart } from "./tv-chart.js";
import {
  coinIconUrl,
  compactUsd,
  filterMarkets,
  formatPickerChange,
  funding8h,
  iconSymbol,
  loadFavs,
  signedChangeClass,
  toggleFav,
} from "./markets.js";
import { applyTicketKind, setCoinIcon } from "./ticket-ui.js";
import { buildBalanceRows, formatPnlPct } from "./balances.js";
import {
  formatChancePct,
  formatOutcomeCountdown,
  formatOutcomeOdds,
  isOutcomeCoin,
  outcomeLegAsset,
  outcomeLegBalance,
  outcomeLegCoin,
  outcomeLegTvCoin,
  outcomePayout,
  outcomePositionMetrics,
  outcomePositionsFromSpot,
  outcomeVenueBadge,
} from "./outcomes.js";
import {
  aggregateLevels,
  bookPrecisions,
  defaultPrecision,
  formatBookPx,
  formatPrec,
  formatSpreadLabel,
  formatTradeTime,
  mergeTrades,
  tradeHashHref,
  tradeIsBuy,
} from "./book.js";

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const n = byId(id);
  if (n) n.textContent = value;
}

function fieldValue(id) {
  const n = byId(id);
  return n ? n.value : "";
}

function emptyNote(message) {
  return note(message, "px-3 py-6 text-center text-[12px] text-mist-400");
}

export function createTradeView(app) {
  const socket = app.socket;
  let markets = [];
  let marketById = {};
  let marketId = "perp:BTC";
  let coin = "BTC";
  let interval = "15m";
  let unsubBook = null;
  let unsubCtx = null;
  let unsubTrades = null;
  let unsubOrders = null;
  let unsubFills = null;
  let unsubTwap = null;
  let book = { bids: [], asks: [], time: 0 };
  let trades = [];
  let bookTab = "book";
  let bookPrec = null;
  let bookUnit = "usdc";
  let marketGen = 0;
  let ctx = { markPx: null, midPx: null, funding: null, oraclePx: null, dayNtlVlm: null, openInterest: null, prevDayPx: null };
  let side = "buy";
  let orderType = "limit";
  let unit = "coin";
  let leverage = 20;
  let isCross = true;
  let ticketBusy = false;
  let enabled = false;
  let twaps = [];
  let extras = { historicalOrders: [], fundingHistory: [], twapHistory: [], twapFills: [], userFees: null };
  let bottomTab = "balances";
  let hideSmallBalances = true;
  let outcomeSideFilter = "all";
  let pendingOutcomeSelect = null;
  let fundingTimer = null;
  let lastTv = "";
  let pickerOpen = false;
  let pickerTab = "all";
  let pickerQuery = "";
  let pickerSort = "change";
  let pickerDir = "desc";
  let pickerHi = 0;
  let pickerRows = [];
  let favs = loadFavs();
  let pageKind = "trade";
  let outcomeLeg = 0;
  let bookSnapshotDone = false;
  let tradesSnapshotDone = false;
  let paneTimer = null;

  function currentMarket() {
    return marketById[marketId] || markets.find((m) => m.id === marketId) || null;
  }

  function isOutcome() {
    const m = currentMarket();
    return !!(m && m.kind === "outcome");
  }

  function isSpot() {
    const m = currentMarket();
    return !!(m && m.kind === "spot");
  }

  function isCash() {
    return isSpot() || isOutcome();
  }

  function hasBookDepth() {
    return ((book.bids && book.bids.length) || (book.asks && book.asks.length)) > 0;
  }

  function syncBookColumn() {
    const shell = document.querySelector(".trade-shell");
    if (!shell) return;
    if (pageKind === "outcome" || isOutcome()) {
      shell.classList.remove("no-book");
      return;
    }
    const live = hasBookDepth() || trades.length > 0;
    if (live) {
      shell.classList.remove("no-book");
      return;
    }
    if (bookSnapshotDone && tradesSnapshotDone) shell.classList.add("no-book");
    else shell.classList.remove("no-book");
  }

  function marketForCoin(c) {
    if (!c) return null;
    return (
      markets.find((x) => x.coin === c) ||
      markets.find((x) => x.noCoin === c) ||
      markets.find((x) => x.balanceCoin === c) ||
      marketById["perp:" + c] ||
      marketById["spot:" + c] ||
      null
    );
  }

  function rowCoin(row) {
    if (!row) return "";
    if (row.coin) return String(row.coin);
    if (row.order && row.order.coin) return String(row.order.coin);
    if (row.state && row.state.coin) return String(row.state.coin);
    if (row.fill && row.fill.coin) return String(row.fill.coin);
    return "";
  }

  function forThisPage(rows) {
    if (pageKind !== "outcome") return rows || [];
    return (rows || []).filter((r) => isOutcomeCoin(rowCoin(r)));
  }

  function visibleMarkets() {
    if (pageKind === "outcome") return markets.filter((m) => m.kind === "outcome");
    return markets.filter((m) => m.kind !== "outcome");
  }

  function mid() {
    const m = currentMarket();
    const fromCtx = num(ctx.midPx) || num(ctx.markPx);
    if (Number.isFinite(fromCtx) && fromCtx > 0) return fromCtx;
    const mids = app.state.data && app.state.data.mids;
    if (mids && coin && num(mids[coin]) > 0) return num(mids[coin]);
    if (m && isOutcome() && outcomeLeg === 1 && num(m.noMarkPx) > 0) return num(m.noMarkPx);
    if (m && num(m.midPx) > 0) return num(m.midPx);
    if (m && num(m.markPx) > 0) return num(m.markPx);
    return NaN;
  }

  function mark() {
    const m = currentMarket();
    const fromCtx = num(ctx.markPx);
    if (Number.isFinite(fromCtx) && fromCtx > 0) return fromCtx;
    const mids = app.state.data && app.state.data.mids;
    if (mids && coin && num(mids[coin]) > 0) return num(mids[coin]);
    if (m && isOutcome() && outcomeLeg === 1 && num(m.noMarkPx) > 0) return num(m.noMarkPx);
    if (m && num(m.markPx) > 0) return num(m.markPx);
    return mid();
  }

  function withdrawable() {
    if (isCash()) {
      const spot = (app.state.data && app.state.data.spot && app.state.data.spot.balances) || [];
      if (side === "sell") {
        const m = currentMarket();
        const key = m && m.kind === "outcome" ? outcomeLegBalance(m, outcomeLeg) : m && m.base;
        const row = spot.find((b) => b && m && String(b.coin) === String(key));
        const px = sizePx() || mark();
        const qty = row ? Math.max(0, num(row.total) - num(row.hold)) : 0;
        return Number.isFinite(px) && px > 0 ? qty * px : qty;
      }
      return spotUsdcParts(spot).available;
    }
    const perps = app.state.data && app.state.data.perps;
    return perps ? num(perps.withdrawable) : NaN;
  }

  function currentPos() {
    const m = currentMarket();
    if (m && (m.kind === "spot" || m.kind === "outcome")) {
      const spot = (app.state.data && app.state.data.spot && app.state.data.spot.balances) || [];
      const key = m.kind === "outcome" ? outcomeLegBalance(m, outcomeLeg) : m.base;
      const row = spot.find((b) => b && String(b.coin) === String(key));
      const qty = row ? Math.max(0, num(row.total) - num(row.hold)) : 0;
      return { coin: m.kind === "outcome" ? (outcomeLeg === 1 ? "No" : "Yes") : m.base, szi: qty, leverage: null };
    }
    const perps = (app.state.data && app.state.data.perps) || {};
    const rows = positionRows(perps.assetPositions || []);
    return rows.find((p) => p.coin === coin) || null;
  }

  function sizePx() {
    if (orderType === "market" || orderType === "twap") return mark();
    const px = num(fieldValue("ticket-price"));
    return Number.isFinite(px) && px > 0 ? px : mark();
  }

  function coinSize() {
    const raw = num(fieldValue("ticket-size"));
    if (!Number.isFinite(raw) || raw <= 0) return NaN;
    if (unit === "usdc") return coinsFromUsdc(raw, sizePx(), currentMarket() ? currentMarket().szDecimals : 5);
    return raw;
  }

  function maxSlippage() {
    const pct = num(fieldValue("ticket-slip"));
    if (Number.isFinite(pct) && pct > 0) return pct / 100;
    return DEFAULT_MAX_SLIPPAGE;
  }

  function ensureChart() {
    const m = currentMarket();
    const chartCoin = m && m.kind === "outcome" ? coin || outcomeLegCoin(m, outcomeLeg) : m ? m.coin : coin;
    const tvCoin = m && m.kind === "outcome" ? outcomeLegTvCoin(m, outcomeLeg) : "";
    const key = (m ? m.id : coin) + "|" + chartCoin + "|" + tvCoin + "|" + interval;
    if (key === lastTv && byId("chart") && byId("chart").firstChild) return;
    lastTv = key;
    const kind = mountChart(byId("chart"), {
      coin: chartCoin,
      tvCoin: tvCoin || undefined,
      hlCoin: chartCoin,
      interval,
      kind: m ? m.kind : pageKind === "outcome" ? "outcome" : "perp",
      base: m && m.base,
      quote: m && m.quote,
      onFallback: () => renderHlIntervalRow(true),
    });
    renderHlIntervalRow(kind === "hl");
  }

  function renderHlIntervalRow(show) {
    const row = byId("hl-iv");
    if (!row) return;
    const on = !!show;
    row.classList.toggle("hidden", !on);
    row.querySelectorAll("[data-hl-iv]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-hl-iv") === interval ? "true" : "false");
    });
  }

  function setChartInterval(next) {
    const allowed = { "1m": 1, "5m": 1, "15m": 1, "1h": 1, "4h": 1, "1d": 1 };
    if (!allowed[next] || interval === next) {
      renderHlIntervalRow(!byId("hl-iv")?.classList.contains("hidden"));
      return;
    }
    interval = next;
    lastTv = "";
    ensureChart();
  }

  function useBookPrice(px) {
    const input = byId("ticket-price");
    const n = num(px);
    if (input && Number.isFinite(n)) {
      const step = Number(bookPrec);
      const decimals =
        Number.isFinite(step) && step > 0
          ? step >= 1
            ? 0
            : Math.min(8, Math.max(0, Math.round(-Math.log10(step) + 1e-9)))
          : undefined;
      input.value = decimals == null ? String(n) : n.toFixed(decimals);
    }
    if (orderType === "market") setOrderType("limit");
    updateEstimate();
  }

  function coinLabel() {
    const m = currentMarket();
    if (m && m.kind === "outcome") return outcomeLeg === 1 ? "No" : "Yes";
    if (m && m.kind === "spot" && m.base) return m.base;
    if (m && m.coin) return m.coin;
    return coin || "Coin";
  }

  function syncBookPrecOptions() {
    const sel = byId("book-prec");
    if (!sel) return;
    const steps = bookPrecisions(mark());
    const keep = steps.find((s) => s === bookPrec);
    if (!keep) bookPrec = defaultPrecision(mark());
    const same =
      sel.options.length === steps.length &&
      Array.prototype.every.call(sel.options, (o, i) => Number(o.value) === steps[i]);
    if (same) {
      sel.value = String(bookPrec);
      return;
    }
    clear(sel);
    steps.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = String(s);
      opt.textContent = formatPrec(s);
      if (s === bookPrec) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.value = String(bookPrec);
  }

  function syncBookUnitLabel() {
    const sel = byId("book-unit");
    if (!sel) return;
    const coinOpt = sel.querySelector('option[value="coin"]');
    if (coinOpt) coinOpt.textContent = coinLabel();
    if (sel.value !== bookUnit) sel.value = bookUnit;
  }

  function setBookTab(tab) {
    bookTab = tab === "trades" ? "trades" : "book";
    document.querySelectorAll("[data-book-tab]").forEach((btn) => {
      btn.setAttribute("aria-selected", btn.getAttribute("data-book-tab") === bookTab ? "true" : "false");
    });
    byId("book-pane")?.classList.toggle("hidden", bookTab !== "book");
    byId("trades-pane")?.classList.toggle("hidden", bookTab !== "trades");
  }

  function displaySize(lv) {
    const sz = num(lv.sz) || 0;
    const px = num(lv.px) || 0;
    return bookUnit === "usdc" ? sz * px : sz;
  }

  function bookRow(level, c, kind, maxCum) {
    const width = Math.min(100, (c / maxCum) * 100);
    return h(
      "button",
      {
        type: "button",
        class: "book-row " + kind,
        title: "Use this price",
        onClick: () => useBookPrice(level.px),
      },
      h("span", { class: "depth", style: { width: width.toFixed(1) + "%" } }),
      h("span", { class: "px" }, formatBookPx(level.px, bookPrec)),
      h("span", { class: "sz" }, fmtQty(displaySize(level))),
      h("span", { class: "sum" }, fmtQty(c))
    );
  }

  function renderBook() {
    syncBookPrecOptions();
    syncBookUnitLabel();
    const name = coinLabel();
    if (bookUnit === "usdc") {
      setText("book-sz-h", "Size (USDC)");
      setText("book-tot-h", "Total (USDC)");
    } else {
      setText("book-sz-h", "Size (" + name + ")");
      setText("book-tot-h", "Total (" + name + ")");
    }
    const asksEl = byId("book-asks");
    const bidsEl = byId("book-bids");
    if (!asksEl || !bidsEl) return;
    const step = Number(bookPrec) > 0 ? Number(bookPrec) : defaultPrecision(mark());
    const asks = aggregateLevels(book.asks || [], step, "ask");
    const bids = aggregateLevels(book.bids || [], step, "bid");
    const askView = asks.slice(0, 18).reverse();
    const bidView = bids.slice(0, 18);
    function cum(rows) {
      let s = 0;
      return rows.map((r) => {
        s += displaySize(r);
        return s;
      });
    }
    const askCum = cum(askView.slice().reverse()).reverse();
    const bidCum = cum(bidView);
    const maxCum = Math.max(askCum[0] || 0, bidCum[bidCum.length - 1] || 0, 1);
    const bestAsk = asks[0] && num(asks[0].px);
    const bestBid = bids[0] && num(bids[0].px);
    const spreadEl = byId("book-spread");
    if (spreadEl) {
      clear(spreadEl);
      spreadEl.appendChild(h("span", null, formatSpreadLabel(bestBid, bestAsk)));
    }
    clear(asksEl);
    clear(bidsEl);
    if (!askView.length && !bidView.length) {
      asksEl.appendChild(note("Waiting for live book…", "px-3 py-6 text-center text-[11px] text-mist-400"));
      syncBookColumn();
      return;
    }
    askView.forEach((lv, i) => asksEl.appendChild(bookRow(lv, askCum[i], "ask", maxCum)));
    bidView.forEach((lv, i) => bidsEl.appendChild(bookRow(lv, bidCum[i], "bid", maxCum)));
    syncBookColumn();
  }

  function renderTrades() {
    const body = byId("trades-body");
    if (!body) return;
    clear(body);
    if (!trades.length) {
      body.appendChild(note("Waiting for live trades…", "px-3 py-6 text-center text-[11px] text-mist-400"));
      syncBookColumn();
      return;
    }
    trades.forEach((t) => {
      const buy = tradeIsBuy(t.side);
      const href = tradeHashHref(t.hash);
      body.appendChild(
        h(
          "div",
          { class: "trade-row" },
          h("span", { class: "px " + (buy ? "buy" : "sell") }, formatBookPx(t.px)),
          h("span", { class: "sz" }, fmtQty(t.sz)),
          h(
            "span",
            { class: "tm" },
            formatTradeTime(t.time),
            href
              ? h(
                  "a",
                  {
                    class: "hash",
                    href,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    title: "Explorer",
                  },
                  "↗"
                )
              : null
          )
        )
      );
    });
    syncBookColumn();
  }

  function pickerOutcomeMode() {
    return pickerTab === "outcome";
  }

  function paintStatSigned(el, ch) {
    if (!el) return;
    el.classList.toggle("up", Number.isFinite(ch) && ch > 0);
    el.classList.toggle("down", Number.isFinite(ch) && ch < 0);
    el.classList.toggle("flat", Number.isFinite(ch) && ch === 0);
  }

  function formatStatChangePct(ch) {
    if (!Number.isFinite(ch)) return "—";
    return (
      (ch * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"
    );
  }

  function marketChange24h(mkt, markPx) {
    const prev = num(ctx.prevDayPx) || (mkt && num(mkt.prevDayPx));
    return change24h(markPx, prev);
  }

  function hydrateOutcomePrevDay(m) {
    if (!m || m.kind !== "outcome" || !m.coin || m._prevDayTried) return;
    m._prevDayTried = true;
    loadDailyPrevDay(m.coin)
      .then((prev) => {
        if (prev == null) return;
        m.prevDayPx = prev;
        const cur = currentMarket();
        if (cur && cur.id === m.id && !(num(ctx.prevDayPx) > 0)) {
          ctx.prevDayPx = prev;
          renderStats();
        }
        if (pickerOpen) renderPicker();
      })
      .catch(() => {});
  }

  function setPickerTab(tab) {
    const next = String(tab || "all");
    if (next === "outcome") {
      if (pickerSort === "change" || pickerSort === "funding" || pickerSort === "price") {
        pickerSort = "chance";
        pickerDir = "desc";
      }
    } else if (pickerSort === "chance") {
      pickerSort = "change";
      pickerDir = "desc";
    }
    pickerTab = next;
    pickerHi = 0;
    renderPicker();
  }

  function renderStats() {
    const mkt = currentMarket();
    const outcome = !!(mkt && mkt.kind === "outcome");
    byId("stats-perp")?.classList.toggle("hidden", outcome);
    byId("stats-outcome")?.classList.toggle("hidden", !outcome);
    const k = mark();
    if (outcome) {
      const mids = (app.state.data && app.state.data.mids) || {};
      const undPx = num(mids[mkt.underlyingKey]) || num(mkt.underlyingPx);
      const undLabel = mkt.underlying || "";
      const undTxt = Number.isFinite(undPx)
        ? (undLabel ? undLabel + " " : "") + fmtPx(undPx)
        : undLabel || "—";
      setText("stat-und", undTxt);
      const cd = formatOutcomeCountdown(mkt.expiryMs);
      setText("stat-ends", cd || "—");
      setText("stat-chance", formatChancePct(k));
      const ch = marketChange24h(mkt, k);
      paintStatSigned(byId("stat-chance"), ch);
      const outCh = byId("stat-out-change");
      if (outCh) {
        outCh.textContent = formatStatChangePct(ch);
        paintStatSigned(outCh, ch);
      }
      setText("stat-yes", Number.isFinite(k) ? fmtPx(k) : "—");
      return;
    }
    const oracle = num(ctx.oraclePx) || (mkt && num(mkt.oraclePx));
    const vol = num(ctx.dayNtlVlm) || (mkt && num(mkt.dayNtlVlm));
    const oi = num(ctx.openInterest) || (mkt && num(mkt.openInterest));
    const ch = marketChange24h(mkt, k);
    const chEl = byId("stat-change");
    if (chEl) {
      chEl.textContent = formatStatChangePct(ch);
      paintStatSigned(chEl, ch);
    }
    setText("stat-mark", Number.isFinite(k) ? fmtPx(k) : "—");
    setText("stat-oracle", Number.isFinite(oracle) ? fmtPx(oracle) : "—");
    setText("stat-volume", Number.isFinite(vol) ? fmtUsd(vol) : "—");
    const oiNtl = Number.isFinite(oi) && Number.isFinite(k) ? oi * k : NaN;
    setText("stat-oi", Number.isFinite(oiNtl) ? fmtUsd(oiNtl) : Number.isFinite(oi) ? fmtQty(oi) : "—");
    const fund = num(ctx.funding);
    const fundTxt = Number.isFinite(fund)
      ? (fund * 100).toLocaleString("en-US", { maximumFractionDigits: 4 }) + "%  " + fundingCountdown()
      : "—";
    setText("stat-funding", fundTxt);
  }

  function updateEstimate() {
    const mkt = currentMarket();
    const sz = coinSize();
    const px = sizePx();
    const ntl = Number.isFinite(sz) && Number.isFinite(px) ? orderValue(sz, px) : NaN;
    const w = withdrawable();
    const lev = isCash() ? 1 : leverage;
    const power = buyingPower(w, lev);
    setText("ticket-avail", Number.isFinite(w) ? fmtUsd(power) + " USDC" : "— USDC");
    const pos = currentPos();
    const posSz = pos ? num(pos.szi) : 0;
    const unitName = (currentMarket() && currentMarket().base) || coin;
    setText("ticket-pos", pos && posSz ? fmtQty(Math.abs(posSz)) + " " + unitName : "0.00000 " + unitName);
    const liq = isCash() ? NaN : estimateLiqPx(mark(), leverage, side === "buy");
    setText("sum-liq", Number.isFinite(liq) ? fmtPx(liq) : "—");
    setText("sum-value", Number.isFinite(ntl) ? fmtUsd(ntl) : "—");
    setText("sum-margin", isCash() ? "—" : Number.isFinite(ntl) ? fmtUsd(marginRequired(ntl, leverage)) : "—");
    const slip = estimateSlippage(orderType === "market" ? mark() : num(fieldValue("ticket-price")), mid(), orderType === "market" || orderType === "stop-market");
    setText("sum-slip-est", "Est. " + (slip * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%");
    const fees = extras.userFees;
    if (fees) {
      setText("sum-fees", "Taker " + formatFeePct(fees.userCrossRate) + " · Maker " + formatFeePct(fees.userAddRate));
    } else {
      setText("sum-fees", "—");
    }
    const minNote = byId("ticket-min");
    if (minNote) minNote.classList.toggle("hidden", isOutcome() || !Number.isFinite(ntl) || ntl >= 10 || !(sz > 0));
    if (mkt) {
      const unitCoin = byId("unit-coin");
      if (unitCoin) unitCoin.textContent = mkt.kind === "outcome" ? (outcomeLeg === 1 ? "No" : "Yes") : mkt.base || mkt.coin;
    }
    if (isOutcome() && mkt) {
      const yesPx = num(mkt.markPx) || num((app.state.data && app.state.data.mids || {})[mkt.coin]);
      const noPx = num(mkt.noMarkPx) || num((app.state.data && app.state.data.mids || {})[mkt.noCoin]);
      setText("leg-yes-odds", formatOutcomeOdds(yesPx));
      setText("leg-no-odds", formatOutcomeOdds(noPx));
      const pay = outcomePayout(sz);
      const legName = outcomeLeg === 1 ? "No" : "Yes";
      setText("sum-payout-k", "Payout if " + legName);
      setText("sum-payout", Number.isFinite(pay) ? fmtUsd(pay) : "—");
    }
    syncTpslFromPrices();
    renderTicketKind();
    renderTicketButton();
  }

  function tpslUnitOf(kind) {
    const id = kind === "tp" ? "ticket-tp-unit" : "ticket-sl-unit";
    return byId(id)?.value === "usd" ? "usd" : "pct";
  }

  function tpslSizeForUsd() {
    const sz = coinSize();
    return Number.isFinite(sz) && sz > 0 ? sz : 1;
  }

  function tpslRef() {
    return tpslRefPx(num(fieldValue("ticket-price")), mark() || mid());
  }

  function syncTpslFromPrices() {
    if (!byId("ticket-tpsl")?.checked) return;
    const ref = tpslRef();
    const isBuy = side === "buy";
    const sz = tpslSizeForUsd();
    const active = typeof document !== "undefined" && document.activeElement && document.activeElement.id;
    for (const kind of ["tp", "sl"]) {
      const gainId = kind === "tp" ? "ticket-tp-gain" : "ticket-sl-loss";
      if (active === gainId) continue;
      const priceId = kind === "tp" ? "ticket-tp" : "ticket-sl";
      const px = num(fieldValue(priceId));
      const el = byId(gainId);
      if (!el) continue;
      if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(ref)) continue;
      const v =
        tpslUnitOf(kind) === "usd"
          ? tpslUsdFromPrice(ref, px, sz, isBuy, kind)
          : tpslMovePct(ref, px, isBuy, kind);
      el.value = formatTpslField(v);
    }
  }

  function applyTpslFromGain(kind) {
    const ref = tpslRef();
    const isBuy = side === "buy";
    const sz = tpslSizeForUsd();
    const gainId = kind === "tp" ? "ticket-tp-gain" : "ticket-sl-loss";
    const priceId = kind === "tp" ? "ticket-tp" : "ticket-sl";
    const raw = num(fieldValue(gainId));
    const el = byId(priceId);
    if (!el || !Number.isFinite(raw) || !Number.isFinite(ref)) return;
    const px =
      tpslUnitOf(kind) === "usd"
        ? tpslPriceFromUsd(ref, raw, sz, isBuy, kind)
        : tpslPriceFromPct(ref, raw, isBuy, kind);
    if (!Number.isFinite(px) || px <= 0) return;
    const mkt = currentMarket();
    el.value = toWire(roundPx(px, mkt ? mkt.szDecimals : 5));
  }

  function setTpslOpen(on) {
    const wrap = byId("ticket-tpsl-wrap");
    wrap?.classList.toggle("is-idle", !on);
    wrap?.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function syncTwapMinutes() {
    const total = twapMinutesFromParts(
      fieldValue("ticket-twap-days"),
      fieldValue("ticket-twap-hours"),
      fieldValue("ticket-twap-mins")
    );
    const hidden = byId("ticket-minutes");
    if (hidden) hidden.value = String(total);
    return total;
  }

  function applyPct(pct) {
    const mkt = currentMarket();
    const sz = sizeFromAvailablePct(
      buyingPower(withdrawable(), isCash() ? 1 : leverage),
      sizePx() || mark(),
      pct,
      mkt ? mkt.szDecimals : 5
    );
    const input = byId("ticket-size");
    if (!input) return;
    if (unit === "usdc") {
      const ntl = sz * (sizePx() || mark());
      input.value = Number.isFinite(ntl) ? String(ntl) : "";
    } else {
      input.value = sz ? String(sz) : "";
    }
    const box = byId("ticket-pct-box");
    const range = byId("ticket-pct");
    if (box) box.value = String(Math.round(pct));
    if (range) range.value = String(Math.round(pct));
    updateEstimate();
  }

  function renderTicketKind() {
    applyTicketKind(document, isOutcome() ? "outcome" : isSpot() ? "spot" : "perp");
    if (isOutcome()) {
      const dd = byId("outcome-otype");
      if (dd && (orderType === "market" || orderType === "limit") && dd.value !== orderType) dd.value = orderType;
      byId("leg-yes")?.setAttribute("aria-pressed", outcomeLeg === 0 ? "true" : "false");
      byId("leg-no")?.setAttribute("aria-pressed", outcomeLeg === 1 ? "true" : "false");
    }
  }

  function setSide(next) {
    side = next;
    const buy = byId("side-buy");
    const sell = byId("side-sell");
    if (buy) {
      buy.setAttribute("aria-pressed", side === "buy" ? "true" : "false");
      buy.classList.toggle("short", false);
    }
    if (sell) {
      sell.setAttribute("aria-pressed", side === "sell" ? "true" : "false");
      sell.classList.toggle("short", side === "sell" && !isOutcome());
    }
    const submit = byId("ticket-submit");
    if (submit) {
      submit.classList.toggle("buy", side === "buy");
      submit.classList.toggle("sell", side === "sell");
    }
    updateEstimate();
  }

  function setOrderType(next) {
    orderType = next;
    document.querySelectorAll("[data-otype]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-otype") === next ? "true" : "false");
    });
    const proOn = next === "scale" || next === "twap" || next === "stop-limit" || next === "stop-market";
    byId("ticket-form")?.classList.toggle("has-pro-extra", proOn);
    const proBtn = byId("pro-toggle");
    if (proBtn) {
      proBtn.setAttribute("aria-pressed", proOn ? "true" : "false");
      proBtn.textContent = proOn
        ? { scale: "Scale", twap: "TWAP", "stop-limit": "Stop Limit", "stop-market": "Stop Market" }[next]
        : "Pro";
    }
    byId("ticket-price-wrap")?.classList.toggle("hidden", next === "market" || next === "twap" || next === "stop-market" || next === "scale");
    byId("ticket-amount-wrap")?.classList.toggle("hidden", false);
    byId("ticket-scale-wrap")?.classList.toggle("hidden", next !== "scale");
    byId("ticket-twap-wrap")?.classList.toggle("hidden", next !== "twap");
    byId("ticket-stop-wrap")?.classList.toggle("hidden", next !== "stop-limit" && next !== "stop-market");
    byId("ticket-stop-limit-price")?.classList.toggle("hidden", next !== "stop-limit");
    const tpslChk = next === "market" || next === "limit";
    const packPad = tpslChk;
    byId("ticket-tpsl-lbl")?.classList.toggle("hidden", !tpslChk);
    byId("ticket-tpsl-pad")?.classList.toggle("tpsl-collapsed", !packPad);
    setTpslOpen(tpslChk && !!byId("ticket-tpsl")?.checked);
    byId("ticket-form")?.classList.toggle("has-tpsl-extra", packPad);
    byId("ticket-chk-row")?.classList.toggle("is-twap", next === "twap");
    byId("ticket-random-lbl")?.classList.toggle("hidden", next !== "twap");
    const sizeK = byId("ticket-size-k");
    if (sizeK) sizeK.textContent = next === "twap" ? "Total Size" : "Size";
    if (next === "twap") syncTwapMinutes();
    updateEstimate();
  }

  function setUnit(next) {
    unit = next;
    byId("unit-coin")?.setAttribute("aria-pressed", next === "coin" ? "true" : "false");
    byId("unit-usdc")?.setAttribute("aria-pressed", next === "usdc" ? "true" : "false");
    updateEstimate();
  }

  function ticketMessage(text, kind) {
    const el = byId("ticket-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("err", "ok");
    if (kind === "err") el.classList.add("err");
    if (kind === "ok") el.classList.add("ok");
  }

  function canTrade() {
    return app.state.source === "wallet" && !!app.state.provider && !!app.state.address;
  }

  function renderTicketButton() {
    const submit = byId("ticket-submit");
    if (!submit) return;
    if (!app.state.address || app.state.source !== "wallet") {
      submit.type = "button";
      submit.disabled = false;
      submit.classList.add("connect");
      submit.classList.toggle("buy", side === "buy");
      submit.classList.toggle("sell", side === "sell");
      const modalOpen =
        typeof document !== "undefined" &&
        document.getElementById("ht-connect-modal") &&
        document.getElementById("ht-connect-modal").classList.contains("is-open");
      submit.textContent = modalOpen ? "Opening wallet…" : "Connect wallet";
      return;
    }
    if (!enabled) {
      submit.type = "submit";
      submit.textContent = "Enable trading";
      submit.disabled = ticketBusy;
      submit.classList.add("connect");
      return;
    }
    submit.type = "submit";
    submit.classList.remove("connect");
    submit.disabled = ticketBusy;
    const verb = side === "buy" ? "Buy" : "Sell";
    if (isOutcome()) submit.textContent = verb + " " + (outcomeLeg === 1 ? "No" : "Yes");
    else submit.textContent = verb + " " + coin;
  }

  async function refreshEnabled() {
    enabled = false;
    if (!canTrade()) {
      renderTicketButton();
      return;
    }
    try {
      const st = await tradingStatus(app.state.address);
      enabled = !!(st.feeOk && st.agentOk);
    } catch {
      enabled = false;
    }
    renderTicketButton();
  }

  function extraTpslWires(mkt, isBuy, sz) {
    if (!byId("ticket-tpsl")?.checked) return [];
    const extras = [];
    const tp = num(fieldValue("ticket-tp"));
    const sl = num(fieldValue("ticket-sl"));
    if (Number.isFinite(tp) && tp > 0) {
      extras.push(
        buildOrderWire({
          asset: mkt.asset,
          isBuy: !isBuy,
          size: sz,
          type: "stop",
          triggerPx: tp,
          tpsl: "tp",
          triggerIsMarket: true,
          reduceOnly: true,
          szDecimals: mkt.szDecimals,
        })
      );
    }
    if (Number.isFinite(sl) && sl > 0) {
      extras.push(
        buildOrderWire({
          asset: mkt.asset,
          isBuy: !isBuy,
          size: sz,
          type: "stop",
          triggerPx: sl,
          tpsl: "sl",
          triggerIsMarket: true,
          reduceOnly: true,
          szDecimals: mkt.szDecimals,
        })
      );
    }
    return extras;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (ticketBusy) return;
    if (!app.state.address || app.state.source !== "wallet") {
      app.connectFromNav && app.connectFromNav();
      return;
    }
    if (!enabled) {
      ticketBusy = true;
      ticketMessage("Waiting for wallet…");
      try {
        await enableTrading({
          provider: app.state.provider,
          address: app.state.address,
          onStatus: (s) => ticketMessage(s),
        });
        enabled = true;
        ticketMessage("Trading enabled.", "ok");
      } catch (err) {
        ticketMessage(userMessage(err), "err");
      } finally {
        ticketBusy = false;
        renderTicketButton();
      }
      return;
    }
    const mkt = currentMarket();
    if (!mkt) {
      ticketMessage("Select a market.", "err");
      return;
    }
    const sz = coinSize();
    ticketBusy = true;
    renderTicketButton();
    const args = {
      source: app.state.source,
      address: app.state.address,
      market: mkt,
      side,
      size: sz,
      reduceOnly: byId("ticket-reduce")?.checked,
      onStatus: (s) => ticketMessage(s),
    };
    try {
      if (orderType === "twap") {
        await placeTwapOrder({
          ...args,
          minutes: syncTwapMinutes(),
          randomize: byId("ticket-random")?.checked,
        });
        ticketMessage("TWAP accepted.", "ok");
      } else if (orderType === "scale") {
        const wires = buildScaleWires({
          asset: mkt.asset,
          isBuy: side === "buy",
          size: sz,
          startPx: fieldValue("ticket-start"),
          endPx: fieldValue("ticket-end"),
          count: fieldValue("ticket-count"),
          skew: fieldValue("ticket-skew") || 1,
          szDecimals: mkt.szDecimals,
          reduceOnly: args.reduceOnly,
        });
        await placeScaleOrders({ source: args.source, address: args.address, orders: wires, onStatus: args.onStatus });
        ticketMessage("Scale orders accepted.", "ok");
      } else {
        const tpsl = extraTpslWires(mkt, side === "buy", sz);
        const type =
          orderType === "stop-market" || orderType === "stop-limit" ? "stop" : orderType === "market" ? "market" : "limit";
        await placePerpOrder({
          ...args,
          price: orderType === "stop-limit" ? fieldValue("ticket-stop-limit") : fieldValue("ticket-price"),
          mid: mid(),
          type,
          tif:
            orderType === "market" || orderType === "stop-market"
              ? "Ioc"
              : isOutcome()
                ? byId("ticket-tif")?.value || "Gtc"
                : "Gtc",
          triggerPx: fieldValue("ticket-trigger"),
          tpsl: "sl",
          triggerIsMarket: orderType !== "stop-limit",
          maxSlippage: maxSlippage(),
          extraOrders: tpsl,
          grouping: tpsl.length ? "normalTpsl" : "na",
          asset: isOutcome() ? outcomeLegAsset(mkt, outcomeLeg) : mkt.asset,
        });
        ticketMessage("Order accepted.", "ok");
      }
      await refreshUserTables();
      app.reloadAccount && app.reloadAccount();
    } catch (err) {
      ticketMessage(userMessage(err), "err");
    } finally {
      ticketBusy = false;
      renderTicketButton();
    }
  }

  function renderMarketChip() {
    const m = currentMarket();
    const pair = byId("market-chip-pair");
    const levEl = byId("market-chip-lev");
    if (pair) pair.textContent = m ? m.pair : coin;
    setCoinIcon(byId("market-chip-icon"), coinIconUrl(iconSymbol(m) || coin));
    if (levEl) {
      levEl.textContent = Math.round(leverage) + "x";
      levEl.classList.toggle("hidden", isCash());
    }
  }

  function closePicker() {
    pickerOpen = false;
    const el = byId("market-picker");
    const chip = byId("market-chip");
    if (el) {
      el.classList.add("hidden");
      el.setAttribute("hidden", "");
    }
    if (chip) chip.setAttribute("aria-expanded", "false");
  }

  function openPicker() {
    pickerOpen = true;
    favs = loadFavs();
    const el = byId("market-picker");
    const chip = byId("market-chip");
    if (el) {
      el.classList.remove("hidden");
      el.removeAttribute("hidden");
    }
    if (chip) chip.setAttribute("aria-expanded", "true");
    renderPicker();
    const search = byId("mp-search");
    if (search) {
      search.value = pickerQuery;
      search.focus();
    }
  }

  function togglePicker() {
    if (pickerOpen) closePicker();
    else openPicker();
  }

  function renderPicker() {
    const body = byId("mp-body");
    if (!body) return;
    document.querySelectorAll("[data-mp-tab]").forEach((btn) => {
      btn.setAttribute("aria-selected", btn.getAttribute("data-mp-tab") === pickerTab ? "true" : "false");
    });
    const outcomeMode = pickerOutcomeMode();
    byId("mp-table")?.classList.toggle("mp-outcome", outcomeMode);
    document.querySelector(".mp-head-perp")?.classList.toggle("hidden", outcomeMode);
    document.querySelector(".mp-head-outcome")?.classList.toggle("hidden", !outcomeMode);
    document.querySelectorAll("[data-mp-sort]").forEach((btn) => {
      const key = btn.getAttribute("data-mp-sort");
      if (key === pickerSort) btn.setAttribute("aria-sort", pickerDir === "asc" ? "asc" : "desc");
      else btn.removeAttribute("aria-sort");
    });
    pickerRows = filterMarkets(markets, {
      tab: pickerTab,
      query: pickerQuery,
      favs,
      sortKey: pickerSort,
      sortDir: pickerDir,
    });
    if (pickerHi >= pickerRows.length) pickerHi = Math.max(0, pickerRows.length - 1);
    clear(body);
    if (!pickerRows.length) {
      body.appendChild(
        h(
          "tr",
          null,
          h(
            "td",
            { colSpan: "6" },
            pickerTab === "outcome" && !pickerQuery ? "No live outcome markets from Hyperliquid." : "No markets match."
          )
        )
      );
      return;
    }
    pickerRows.forEach((m, i) => {
      const chCell = formatPickerChange(m.markPx, m.prevDayPx);
      const fund = funding8h(m.funding);
      const fundTxt =
        m.kind === "perp" && Number.isFinite(fund)
          ? (fund * 100).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + "%"
          : "—";
      const oiNtl = Number(m.openInterest) * Number(m.markPx);
      const starred = favs.indexOf(m.id) !== -1;
      const venue = m.kind === "outcome" ? outcomeVenueBadge(m.venue) : "";
      const tr = h("tr", {
        class: "mp-row" + (i === pickerHi ? " is-on" : ""),
        dataset: { mid: m.id },
        onClick: () => selectPickerRow(m.id),
        onMouseEnter: () => {
          pickerHi = i;
          syncPickerHighlight();
        },
      });
      tr.appendChild(
        h(
          "td",
          null,
          h(
            "div",
            { class: "mp-mkt" },
            h(
              "button",
              {
                type: "button",
                class: "mp-star" + (starred ? " on" : ""),
                title: starred ? "Unfavorite" : "Favorite",
                onClick: (ev) => {
                  ev.stopPropagation();
                  favs = toggleFav(m.id);
                  renderPicker();
                },
              },
              starred ? "★" : "☆"
            ),
            coinIconUrl(iconSymbol(m))
              ? h("img", {
                  class: "coin-icon mp-icon",
                  alt: "",
                  hidden: true,
                  width: "16",
                  height: "16",
                  onError: (ev) => {
                    ev.currentTarget.hidden = true;
                    ev.currentTarget.removeAttribute("src");
                  },
                  onLoad: (ev) => {
                    ev.currentTarget.hidden = false;
                  },
                  src: coinIconUrl(iconSymbol(m)),
                })
              : null,
            h("span", { class: "mp-pair" }, m.pair),
            m.kind === "perp"
              ? h("span", { class: "mp-badge perp" }, "PERP")
              : m.kind === "spot"
                ? h("span", { class: "mp-badge" }, "SPOT")
                : venue
                  ? h("span", { class: "mp-badge " + venue }, venue)
                  : null
          )
        )
      );
      if (outcomeMode) {
        const ch = change24h(m.markPx, m.prevDayPx);
        tr.appendChild(h("td", { class: signedChangeClass(ch) }, formatChancePct(m.markPx)));
        tr.appendChild(h("td", { class: "mp-outcome-hide" }, ""));
        tr.appendChild(h("td", { class: "mp-outcome-hide" }, ""));
        tr.appendChild(h("td", null, compactUsd(m.dayNtlVlm)));
        tr.appendChild(
          h(
            "td",
            null,
            Number.isFinite(Number(m.openInterest)) && Number(m.openInterest) > 0
              ? compactUsd(Number(m.openInterest) * (num(m.markPx) || 1))
              : "—"
          )
        );
      } else {
        tr.appendChild(h("td", null, Number.isFinite(num(m.markPx)) ? fmtPx(m.markPx) : "—"));
        tr.appendChild(h("td", { class: chCell.cls }, chCell.text));
        tr.appendChild(
          h(
            "td",
            { class: Number.isFinite(fund) && fund < 0 ? "mp-chg down" : Number.isFinite(fund) && fund > 0 ? "mp-chg up" : "mp-muted" },
            fundTxt
          )
        );
        tr.appendChild(h("td", null, compactUsd(m.dayNtlVlm)));
        tr.appendChild(h("td", null, m.kind === "perp" && Number.isFinite(oiNtl) ? compactUsd(oiNtl) : "—"));
      }
      body.appendChild(tr);
    });
    syncPickerHighlight();
  }

  function syncPickerHighlight() {
    const body = byId("mp-body");
    if (!body) return;
    Array.prototype.forEach.call(body.children, (tr, i) => {
      tr.classList.toggle("is-on", i === pickerHi);
      if (i === pickerHi && typeof tr.scrollIntoView === "function") {
        tr.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function selectPickerRow(id) {
    closePicker();
    const m = marketById[id] || markets.find((x) => x.id === id) || null;
    const want = m && m.kind === "outcome" ? "outcome" : "trade";
    if (m && want !== pageKind && typeof app.navigate === "function") {
      marketId = m.id;
      app.navigate(want);
      return;
    }
    setMarket(id);
  }

  function onPickerKey(ev) {
    if (!pickerOpen) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      closePicker();
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      pickerHi = Math.min(pickerRows.length - 1, pickerHi + 1);
      syncPickerHighlight();
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      pickerHi = Math.max(0, pickerHi - 1);
      syncPickerHighlight();
      return;
    }
    if (ev.key === "Enter" && pickerRows[pickerHi]) {
      ev.preventDefault();
      selectPickerRow(pickerRows[pickerHi].id);
    }
  }

  function renderMarketSelect() {
    renderMarketChip();
    if (pickerOpen) renderPicker();
  }

  function syncLeverageFromPos() {
    const pos = currentPos();
    const mkt = currentMarket();
    if (pos && pos.leverage) {
      const v = Number(pos.leverage.value);
      if (Number.isFinite(v) && v > 0) leverage = v;
      isCross = String(pos.leverage.type || "cross") !== "isolated";
    } else if (mkt && Number(mkt.maxLeverage) > 0) {
      leverage = Math.min(leverage, Number(mkt.maxLeverage));
    }
    setText("lev-label", Math.round(leverage) + "x");
    renderMarketChip();
    byId("mode-isolated")?.setAttribute("aria-pressed", isCross ? "false" : "true");
    byId("mode-cross")?.setAttribute("aria-pressed", isCross ? "true" : "false");
    const range = byId("lev-range");
    const inp = byId("lev-input");
    const max = mkt && mkt.maxLeverage ? Number(mkt.maxLeverage) : 50;
    if (range) {
      range.max = String(max);
      range.value = String(leverage);
    }
    if (inp) inp.value = String(Math.round(leverage));
  }

  async function applyLeverage() {
    if (!canTrade() || !enabled) {
      ticketMessage("Enable trading first.", "err");
      return;
    }
    if (isCash()) return;
    const mkt = currentMarket();
    if (!mkt) return;
    const v = num(fieldValue("lev-input")) || num(byId("lev-range") && byId("lev-range").value);
    try {
      await setLeverage({
        source: app.state.source,
        address: app.state.address,
        asset: mkt.asset,
        isCross,
        leverage: v,
        onStatus: (s) => ticketMessage(s),
      });
      leverage = Math.round(v);
      setText("lev-label", leverage + "x");
      renderMarketChip();
      byId("lev-pop")?.classList.add("hidden");
      ticketMessage("Leverage updated.", "ok");
      updateEstimate();
    } catch (err) {
      ticketMessage(userMessage(err), "err");
    }
  }

  function histTable(headers, rows) {
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

  function renderBalances() {
    const root = byId("trade-balances");
    if (!root) return;
    clear(root);
    byId("bal-hide-wrap")?.classList.toggle("hidden", bottomTab !== "balances");
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load balances."));
      return;
    }
    const perps = (app.state.data && app.state.data.perps) || {};
    const spot = (app.state.data && app.state.data.spot && app.state.data.spot.balances) || [];
    const mids = (app.state.data && app.state.data.mids) || {};
    const spotForPage =
      pageKind === "outcome" ? spot.filter((b) => b && isOutcomeCoin(b.coin)) : spot;
    const rows = buildBalanceRows({
      perps,
      spotBalances: spotForPage,
      mids,
      markets,
      hideSmall: hideSmallBalances,
    });
    if (!rows.length) {
      root.appendChild(emptyNote("No balances."));
      return;
    }
    const body = rows.map((r) => {
      const url = coinIconUrl(r.iconCoin);
      const pnlTxt = formatPnlPct(r.pnlPct);
      const pnlCls =
        r.pnlPct == null || !Number.isFinite(r.pnlPct) || r.pnlPct === 0
          ? ""
          : r.pnlPct > 0
            ? " up"
            : " down";
      return h(
        "tr",
        { class: "bal-row" },
        h(
          "td",
          { class: "bal-asset" },
          url
            ? h("img", {
                class: "coin-icon mp-icon",
                alt: "",
                hidden: true,
                width: "16",
                height: "16",
                onError: (ev) => {
                  ev.currentTarget.hidden = true;
                  ev.currentTarget.removeAttribute("src");
                },
                onLoad: (ev) => {
                  ev.currentTarget.hidden = false;
                },
                src: url,
              })
            : null,
          h("span", null, r.coin)
        ),
        h("td", null, fmtQty(r.total)),
        h("td", null, fmtQty(r.available)),
        h("td", null, Number.isFinite(r.value) ? fmtUsd(r.value) : "—"),
        h("td", { class: "bal-pnl" + pnlCls }, pnlTxt)
      );
    });
    root.appendChild(
      h(
        "table",
        { class: "bal-table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", null, "Asset"),
            h("th", null, "Total Balance"),
            h("th", null, "Available Balance"),
            h("th", null, "Value (USD)"),
            h("th", null, "PNL %")
          )
        ),
        h("tbody", null, ...body)
      )
    );
  }

  function renderPositions() {
    const root = byId("trade-positions");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load positions."));
      return;
    }
    const perps = (app.state.data && app.state.data.perps) || {};
    const rows = positionRows(perps.assetPositions || []);
    const mids = (app.state.data && app.state.data.mids) || {};
    if (!rows.length) {
      root.appendChild(emptyNote("No open perps."));
      return;
    }
    root.appendChild(
      histTable(
        ["Market", "Side", "Size", "Entry", "Mark", "Liq.", "Lev", "uPnL"],
        rows.map((p) => {
          const szi = num(p.szi);
          return h(
            "tr",
            { class: "cursor-pointer hover:bg-ink-700", onClick: () => setMarket(p.coin) },
            h("td", { class: "px-2 py-1.5 font-normal text-mist-100" }, p.coin),
            h("td", { class: "px-2 py-1.5 " + (szi >= 0 ? "text-buy" : "text-sell") }, szi >= 0 ? "Long" : "Short"),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(Math.abs(szi))),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtPx(p.entryPx)),
            h("td", { class: "px-2 py-1.5 font-mono" }, mids[p.coin] == null ? "—" : fmtPx(mids[p.coin])),
            h("td", { class: "px-2 py-1.5 font-mono" }, p.liquidationPx ? fmtPx(p.liquidationPx) : "—"),
            h("td", { class: "px-2 py-1.5" }, levLabel(p.leverage)),
            h("td", { class: "px-2 py-1.5 font-mono " + pnlClass(p.unrealizedPnl) }, fmtUsd(p.unrealizedPnl, { signed: true }))
          );
        })
      )
    );
  }

  function jumpToOutcome(p) {
    if (!p || !p.marketId) return;
    if (pageKind !== "outcome") {
      pendingOutcomeSelect = p;
      if (typeof app.navigate === "function") app.navigate("outcome");
      return;
    }
    Promise.resolve(setMarket(p.marketId)).then(() => {
      if (p.side === "No") setOutcomeLeg(1);
    });
  }

  function outcomesHead() {
    return h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", null, "Market"),
        h("th", null, "Size"),
        h("th", null, "Available Size"),
        h("th", null, "Position Value"),
        h("th", null, "Entry Price"),
        h("th", null, "Mark Price"),
        h("th", null, "PNL (ROE %)")
      )
    );
  }

  function renderOutcomes() {
    const root = byId("trade-outcomes");
    if (!root) return;
    clear(root);
    byId("out-filter-wrap")?.classList.toggle("hidden", bottomTab !== "outcomes");
    document.querySelectorAll("[data-out-side]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-out-side") === outcomeSideFilter ? "true" : "false");
    });
    const emptyBody = h(
      "tr",
      null,
      h("td", { colSpan: "7", class: "out-empty" }, "No outcomes yet")
    );
    if (!app.state.address) {
      root.appendChild(h("table", { class: "bal-table out-table" }, outcomesHead(), h("tbody", null, emptyBody)));
      return;
    }
    const spot = (app.state.data && app.state.data.spot && app.state.data.spot.balances) || [];
    let rows = outcomePositionsFromSpot(spot, markets);
    if (outcomeSideFilter === "Yes" || outcomeSideFilter === "No") {
      rows = rows.filter((r) => r.side === outcomeSideFilter);
    }
    if (!rows.length) {
      root.appendChild(h("table", { class: "bal-table out-table" }, outcomesHead(), h("tbody", null, emptyBody)));
      return;
    }
    const body = rows.map((p) => {
      const m = outcomePositionMetrics(p);
      const pnlTxt =
        m.pnlPct == null && !Number.isFinite(m.pnlUsd)
          ? "—"
          : (Number.isFinite(m.pnlUsd) ? fmtUsd(m.pnlUsd, { signed: true }) : "—") +
            " (" +
            formatPnlPct(m.pnlPct) +
            ")";
      const pnlCls =
        m.pnlPct == null || !Number.isFinite(m.pnlPct) || m.pnlPct === 0 ? "" : m.pnlPct > 0 ? " up" : " down";
      return h(
        "tr",
        null,
        h(
          "td",
          null,
          h(
            "button",
            {
              type: "button",
              class: "out-mkt-btn",
              onClick: () => jumpToOutcome(p),
            },
            p.title,
            h("span", { class: "out-mkt-side" }, " " + p.side)
          )
        ),
        h("td", null, fmtQty(p.total)),
        h("td", null, fmtQty(p.available)),
        h("td", null, Number.isFinite(m.value) ? fmtUsd(m.value) : "—"),
        h("td", null, Number.isFinite(m.entryPx) ? fmtPx(m.entryPx) : "—"),
        h("td", null, p.markPx == null ? "—" : fmtPx(p.markPx)),
        h("td", { class: "bal-pnl" + pnlCls }, pnlTxt)
      );
    });
    root.appendChild(
      h("table", { class: "bal-table out-table" }, outcomesHead(), h("tbody", null, ...body))
    );
  }

  function assetForCoin(c) {
    const hit = marketForCoin(c);
    if (!hit) return null;
    if (hit.noCoin && c === hit.noCoin) return hit.noAsset;
    return hit.asset;
  }

  function renderOrders() {
    const root = byId("trade-orders");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load open orders."));
      return;
    }
    const orders = forThisPage((app.state.data && app.state.data.openOrders) || []);
    const tradeable = canTrade();
    if (!orders.length) {
      root.appendChild(emptyNote(pageKind === "outcome" ? "No open outcome orders." : "No open orders."));
      return;
    }
    root.appendChild(
      histTable(
        ["Time", "Coin", "Direction", "Size", "Filled Size", "Order Value", "Price", "Reduce Only", "Trigger Conditions", "Status", "Order ID", ""],
        orders.map((o) => {
          const cash = pageKind === "outcome" || isOutcomeCoin(o.coin);
          const dir = o.side === "B" ? (cash ? "Buy" : "Open Long") : cash ? "Sell" : "Open Short";
          const m = marketForCoin(o.coin);
          const label = m && m.kind === "outcome" ? m.pair : o.coin;
          return h(
            "tr",
            null,
            h("td", { class: "px-2 py-1.5 text-mist-400" }, formatClock(o.timestamp)),
            h("td", { class: "px-2 py-1.5 text-white" }, label),
            h("td", { class: "px-2 py-1.5 " + (o.side === "B" ? "text-buy" : "text-sell") }, dir),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(o.origSz || o.sz)),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(o.origSz != null ? num(o.origSz) - num(o.sz) : 0)),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtUsd(num(o.sz) * num(o.limitPx))),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtPx(o.limitPx)),
            h("td", { class: "px-2 py-1.5" }, o.reduceOnly ? "Yes" : "No"),
            h("td", { class: "px-2 py-1.5" }, o.isTrigger ? String(o.triggerPx || o.orderType || "Trigger") : "—"),
            h("td", { class: "px-2 py-1.5" }, "Open"),
            h("td", { class: "px-2 py-1.5 font-mono" }, String(o.oid)),
            h(
              "td",
              { class: "px-2 py-1.5" },
              tradeable
                ? h("button", { type: "button", class: "text-sell hover:underline", onClick: () => onCancel(o.coin, Number(o.oid)) }, "Cancel")
                : ""
            )
          );
        })
      )
    );
  }

  function renderTwap() {
    const root = byId("trade-twap");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load TWAPs."));
      return;
    }
    const hist = forThisPage(extras.twapHistory || []);
    const fills = forThisPage(extras.twapFills || []);
    const live = forThisPage(twaps || []);
    if (!hist.length && !live.length && !fills.length) {
      root.appendChild(emptyNote(pageKind === "outcome" ? "No outcome TWAPs." : "No TWAP orders."));
      return;
    }
    const rows = [];
    live.forEach((t) => {
      const st = t.state || t;
      rows.push(
        h(
          "tr",
          null,
          h("td", { class: "px-2 py-1.5 text-white" }, st.coin || "—"),
          h("td", { class: "px-2 py-1.5" }, st.side === "B" ? "Buy" : "Sell"),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(st.sz)),
          h("td", { class: "px-2 py-1.5" }, String(st.minutes || "") + "m"),
          h("td", { class: "px-2 py-1.5" }, "activated"),
          h(
            "td",
            { class: "px-2 py-1.5" },
            canTrade() && t.id != null
              ? h("button", { type: "button", class: "text-sell hover:underline", onClick: () => onCancelTwap(st.coin || "", Number(t.id)) }, "Cancel")
              : ""
          )
        )
      );
    });
    hist.slice(0, 40).forEach((t) => {
      const st = t.state || {};
      const status = t.status && t.status.status ? t.status.status : "";
      rows.push(
        h(
          "tr",
          null,
          h("td", { class: "px-2 py-1.5 text-white" }, st.coin || "—"),
          h("td", { class: "px-2 py-1.5" }, st.side === "B" ? "Buy" : "Sell"),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(st.sz)),
          h("td", { class: "px-2 py-1.5" }, String(st.minutes || "") + "m"),
          h("td", { class: "px-2 py-1.5" }, status),
          h("td", { class: "px-2 py-1.5" }, "")
        )
      );
    });
    fills.slice(0, 20).forEach((f) => {
      const fill = f.fill || f;
      rows.push(
        h(
          "tr",
          null,
          h("td", { class: "px-2 py-1.5 text-white" }, fill.coin || "—"),
          h("td", { class: "px-2 py-1.5" }, fill.side === "B" ? "Buy" : "Sell"),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(fill.sz)),
          h("td", { class: "px-2 py-1.5" }, "slice"),
          h("td", { class: "px-2 py-1.5" }, fill.closedPnl != null ? "filled" : "slice fill"),
          h("td", { class: "px-2 py-1.5" }, "")
        )
      );
    });
    root.appendChild(histTable(["Coin", "Side", "Size", "Minutes", "Status", ""], rows));
  }

  function renderFunding() {
    const root = byId("trade-funding");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load funding history."));
      return;
    }
    if (pageKind === "outcome") {
      root.appendChild(emptyNote("Outcome markets do not pay funding."));
      return;
    }
    const rows = extras.fundingHistory || [];
    if (!rows.length) {
      root.appendChild(emptyNote("No funding history."));
      return;
    }
    root.appendChild(
      histTable(
        ["Time", "Coin", "Size", "Position", "Payment", "Rate"],
        rows.slice(0, 50).map((f) => {
          const d = f.delta || {};
          return h(
            "tr",
            null,
            h("td", { class: "px-2 py-1.5 text-mist-400" }, formatLocalTime(f.time)),
            h("td", { class: "px-2 py-1.5 text-white" }, d.coin || "—"),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(d.szi)),
            h("td", { class: "px-2 py-1.5" }, num(d.szi) >= 0 ? "Long" : "Short"),
            h("td", { class: "px-2 py-1.5 font-mono " + pnlClass(d.usdc) }, fmtUsd(d.usdc, { signed: true })),
            h("td", { class: "px-2 py-1.5 font-mono" }, formatFeePct(d.fundingRate))
          );
        })
      )
    );
  }

  function renderHistory() {
    const root = byId("trade-history");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load order history."));
      return;
    }
    if (pageKind === "outcome") {
      const fills = forThisPage((app.state.data && app.state.data.fills) || []);
      if (!fills.length) {
        root.appendChild(emptyNote("No outcome fills."));
        return;
      }
      root.appendChild(
        histTable(
          ["Time", "Coin", "Side", "Size", "Price", "Fee", "Closed PnL"],
          fills.slice(0, 50).map((f) => {
            const m = marketForCoin(f.coin);
            const label = m && m.kind === "outcome" ? m.pair : f.coin;
            return h(
              "tr",
              null,
              h("td", { class: "px-2 py-1.5 text-mist-400" }, formatLocalTime(f.time)),
              h("td", { class: "px-2 py-1.5 text-white" }, label),
              h("td", { class: "px-2 py-1.5 " + (f.side === "B" ? "text-buy" : "text-sell") }, f.side === "B" ? "Buy" : "Sell"),
              h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(f.sz)),
              h("td", { class: "px-2 py-1.5 font-mono" }, fmtPx(f.px)),
              h("td", { class: "px-2 py-1.5 font-mono" }, f.fee != null ? fmtUsd(f.fee) : "—"),
              h("td", { class: "px-2 py-1.5 font-mono " + pnlClass(f.closedPnl) }, f.closedPnl != null ? fmtUsd(f.closedPnl, { signed: true }) : "—")
            );
          })
        )
      );
      return;
    }
    const rows = extras.historicalOrders || [];
    if (!rows.length) {
      root.appendChild(emptyNote("No order history."));
      return;
    }
    root.appendChild(
      histTable(
        ["Time", "Coin", "Direction", "Size", "Price", "Status", "Order ID"],
        rows.slice(0, 50).map((row) => {
          const o = row.order || row;
          return h(
            "tr",
            null,
            h("td", { class: "px-2 py-1.5 text-mist-400" }, formatLocalTime(o.timestamp)),
            h("td", { class: "px-2 py-1.5 text-white" }, o.coin),
            h("td", { class: "px-2 py-1.5" }, o.side === "B" ? "Long" : "Short"),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(o.sz || o.origSz)),
            h("td", { class: "px-2 py-1.5 font-mono" }, fmtPx(o.limitPx)),
            h("td", { class: "px-2 py-1.5" }, row.status || "—"),
            h("td", { class: "px-2 py-1.5 font-mono" }, String(o.oid || ""))
          );
        })
      )
    );
  }

  function renderBottom() {
    renderBalances();
    renderPositions();
    renderOutcomes();
    renderOrders();
    renderTwap();
    renderFunding();
    renderHistory();
  }

  async function onCancel(c, oid) {
    if (!canTrade()) {
      ticketMessage("Connect a wallet to cancel orders.", "err");
      return;
    }
    if (!enabled) {
      ticketMessage("Enable trading first.", "err");
      return;
    }
    const asset = assetForCoin(c);
    if (asset == null) return;
    try {
      ticketMessage("Canceling…");
      await cancelOrders({
        source: app.state.source,
        address: app.state.address,
        cancels: [{ asset, oid }],
        onStatus: (s) => ticketMessage(s),
      });
      ticketMessage("Canceled oid " + oid + ".", "ok");
      await refreshUserTables();
    } catch (err) {
      ticketMessage(userMessage(err), "err");
    }
  }

  async function onCancelTwap(c, twapId) {
    if (!canTrade() || !enabled) {
      ticketMessage("Enable trading first.", "err");
      return;
    }
    try {
      await cancelTwap({
        source: app.state.source,
        address: app.state.address,
        asset: assetForCoin(c),
        twapId,
        onStatus: (s) => ticketMessage(s),
      });
      ticketMessage("TWAP canceled.", "ok");
      await refreshUserTables();
    } catch (err) {
      ticketMessage(userMessage(err), "err");
    }
  }

  async function refreshUserTables() {
    if (!app.state.address) {
      extras = { historicalOrders: [], fundingHistory: [], twapHistory: [], twapFills: [], userFees: extras.userFees };
      renderBottom();
      return;
    }
    try {
      const [orders, fills, more] = await Promise.all([
        hlInfo({ type: "frontendOpenOrders", user: app.state.address }),
        hlInfo({ type: "userFills", user: app.state.address }),
        loadTradeExtras(app.state.address),
      ]);
      if (app.state.data) {
        app.state.data.openOrders = Array.isArray(orders) ? orders : [];
        app.state.data.fills = Array.isArray(fills) ? fills : [];
      }
      extras = more;
    } catch {
      /* keep previous */
    }
    renderBottom();
    updateEstimate();
  }

  function subscribeMarket() {
    const gen = ++marketGen;
    const c = coin;
    if (unsubBook) unsubBook();
    if (unsubCtx) unsubCtx();
    if (unsubTrades) unsubTrades();
    unsubBook = unsubCtx = unsubTrades = null;
    book = { bids: [], asks: [], time: 0 };
    trades = [];
    bookPrec = null;
    bookSnapshotDone = false;
    tradesSnapshotDone = false;
    if (paneTimer) {
      clearTimeout(paneTimer);
      paneTimer = null;
    }
    document.querySelector(".trade-shell")?.classList.remove("no-book");
    renderBook();
    renderTrades();
    if (!c) {
      bookSnapshotDone = true;
      tradesSnapshotDone = true;
      syncBookColumn();
      return;
    }
    unsubBook = socket.subscribe({ type: "l2Book", coin: c }, (data) => {
      if (gen !== marketGen) return;
      book = bookLevels(data);
      bookSnapshotDone = true;
      renderBook();
    });
    unsubTrades = socket.subscribe({ type: "trades", coin: c }, (data) => {
      if (gen !== marketGen) return;
      const incoming = Array.isArray(data) ? data : data ? [data] : [];
      trades = mergeTrades(trades, incoming);
      renderTrades();
    });
    hlInfo({ type: "recentTrades", coin: c })
      .then((rows) => {
        if (gen !== marketGen) return;
        if (Array.isArray(rows)) trades = mergeTrades(trades, rows);
        tradesSnapshotDone = true;
        renderTrades();
      })
      .catch(() => {
        if (gen !== marketGen) return;
        tradesSnapshotDone = true;
        renderTrades();
      });
    paneTimer = setTimeout(() => {
      if (gen !== marketGen) return;
      bookSnapshotDone = true;
      tradesSnapshotDone = true;
      renderBook();
      renderTrades();
    }, 4000);
    const m = currentMarket();
    const ctxSub =
      m && (m.kind === "spot" || m.kind === "outcome")
        ? { type: "activeSpotAssetCtx", coin: c }
        : { type: "activeAssetCtx", coin: c };
    unsubCtx = socket.subscribe(ctxSub, (data) => {
      if (gen !== marketGen) return;
      const ctxRow = data && data.ctx ? data.ctx : data;
      if (!ctxRow) return;
      ctx = {
        markPx: ctxRow.markPx,
        midPx: ctxRow.midPx,
        funding: ctxRow.funding,
        oraclePx: ctxRow.oraclePx,
        dayNtlVlm: ctxRow.dayNtlVlm,
        openInterest: ctxRow.openInterest,
        prevDayPx: ctxRow.prevDayPx != null && ctxRow.prevDayPx !== "" ? ctxRow.prevDayPx : ctx.prevDayPx,
      };
      const live = currentMarket();
      if (live && num(ctx.prevDayPx) > 0) live.prevDayPx = ctx.prevDayPx;
      renderStats();
      updateEstimate();
    });
  }

  function subscribeUser() {
    if (unsubOrders) unsubOrders();
    if (unsubFills) unsubFills();
    if (unsubTwap) unsubTwap();
    unsubOrders = unsubFills = unsubTwap = null;
    const user = app.state.address;
    if (!user) {
      twaps = [];
      renderBottom();
      return;
    }
    unsubOrders = socket.subscribe({ type: "orderUpdates", user }, () => refreshUserTables());
    unsubFills = socket.subscribe({ type: "userFills", user }, () => refreshUserTables());
    unsubTwap = socket.subscribe({ type: "twapStates", user }, (data) => {
      const states = data && (data.states || data);
      if (Array.isArray(states)) {
        twaps = states.map((pair) => (Array.isArray(pair) ? { id: pair[0], state: pair[1] } : pair));
      }
      renderTwap();
    });
  }

  async function setMarket(next) {
    const vis = visibleMarkets();
    let m =
      (next && marketById[next]) ||
      vis.find((x) => x.id === next) ||
      vis.find((x) => x.coin === next) ||
      null;
    if (m && pageKind === "outcome" && m.kind !== "outcome") m = null;
    if (m && pageKind !== "outcome" && m.kind === "outcome") m = null;
    if (!m && vis.length) {
      m = pageKind === "outcome" ? vis[0] : vis.find((x) => x.coin === "BTC" && x.kind === "perp") || vis[0];
    }
    if (!m) {
      marketId = "";
      coin = "";
      const pair = byId("market-chip-pair");
      if (pair) pair.textContent = pageKind === "outcome" ? "No outcomes" : "—";
      setCoinIcon(byId("market-chip-icon"), null);
      byId("market-chip-lev")?.classList.add("hidden");
      lastTv = "empty";
      mountChart(byId("chart"), { coin: "", kind: pageKind === "outcome" ? "outcome" : "perp" });
      renderHlIntervalRow(false);
      book = { bids: [], asks: [], time: 0 };
      trades = [];
      bookSnapshotDone = true;
      tradesSnapshotDone = true;
      renderBook();
      renderTrades();
      renderTicketKind();
      return;
    }
    if (m.kind === "outcome") {
      if (marketId !== m.id) outcomeLeg = 0;
      if (orderType !== "market" && orderType !== "limit") setOrderType("limit");
    }
    marketId = m.id;
    coin = m.kind === "outcome" ? outcomeLegCoin(m, outcomeLeg) || m.coin : m.coin;
    renderMarketChip();
    setUnit(unit === "usdc" ? "usdc" : "coin");
    const yesPx = num(m.markPx) || num(m.midPx);
    const noPx = num(m.noMarkPx);
    const seed = m.kind === "outcome" && outcomeLeg === 1 ? noPx : yesPx;
    ctx = {
      markPx: seed,
      midPx: seed,
      funding: m.funding,
      oraclePx: m.kind === "outcome" ? seed : m.oraclePx,
      dayNtlVlm: m.dayNtlVlm,
      openInterest: m.openInterest,
      prevDayPx: m.prevDayPx,
    };
    if (m.kind === "outcome") hydrateOutcomePrevDay(m);
    syncLeverageFromPos();
    renderTicketKind();
    renderStats();
    updateEstimate();
    ensureChart();
    subscribeMarket();
    const thisGen = marketGen;
    const snap = await hlInfo({ type: "l2Book", coin }).catch(() => null);
    if (thisGen !== marketGen) return;
    bookSnapshotDone = true;
    if (snap) book = bookLevels(snap);
    renderBook();
  }

  function setOutcomeLeg(next) {
    const m = currentMarket();
    const leg = next === 1 ? 1 : 0;
    if (leg === outcomeLeg && coin === outcomeLegCoin(m, leg)) {
      renderTicketKind();
      updateEstimate();
      return;
    }
    outcomeLeg = leg;
    if (!m || m.kind !== "outcome") {
      renderTicketKind();
      updateEstimate();
      return;
    }
    coin = outcomeLegCoin(m, outcomeLeg) || m.coin;
    const px = outcomeLeg === 1 ? num(m.noMarkPx) : num(m.markPx) || num(m.midPx);
    ctx = {
      markPx: px,
      midPx: px,
      funding: null,
      oraclePx: px,
      dayNtlVlm: m.dayNtlVlm,
      openInterest: m.openInterest,
      prevDayPx: m.prevDayPx,
    };
    lastTv = "";
    renderTicketKind();
    renderStats();
    updateEstimate();
    ensureChart();
    subscribeMarket();
    hlInfo({ type: "l2Book", coin })
      .then((snap) => {
        if (snap) book = bookLevels(snap);
        bookSnapshotDone = true;
        renderBook();
      })
      .catch(() => {
        bookSnapshotDone = true;
        renderBook();
      });
  }

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    byId("market-chip")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      togglePicker();
    });
    byId("market-picker")?.addEventListener("click", (ev) => ev.stopPropagation());
    byId("mp-search")?.addEventListener("input", (ev) => {
      pickerQuery = ev.target.value;
      pickerHi = 0;
      renderPicker();
    });
    document.querySelectorAll("[data-mp-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setPickerTab(btn.getAttribute("data-mp-tab"));
      });
    });
    document.querySelectorAll("[data-mp-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-mp-sort");
        if (pickerSort === key) pickerDir = pickerDir === "desc" ? "asc" : "desc";
        else {
          pickerSort = key;
          pickerDir = key === "change" || key === "funding" || key === "chance" ? "desc" : "desc";
        }
        renderPicker();
      });
    });
    document.addEventListener("keydown", onPickerKey);
    document.querySelectorAll("[data-book-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setBookTab(btn.getAttribute("data-book-tab")));
    });
    byId("book-prec")?.addEventListener("change", (ev) => {
      const v = num(ev.target.value);
      if (Number.isFinite(v) && v > 0) bookPrec = v;
      renderBook();
    });
    byId("book-unit")?.addEventListener("change", (ev) => {
      bookUnit = ev.target.value === "coin" ? "coin" : "usdc";
      renderBook();
    });
    setBookTab(bookTab);
    byId("side-buy")?.addEventListener("click", () => setSide("buy"));
    byId("side-sell")?.addEventListener("click", () => setSide("sell"));
    byId("leg-yes")?.addEventListener("click", () => setOutcomeLeg(0));
    byId("leg-no")?.addEventListener("click", () => setOutcomeLeg(1));
    byId("outcome-otype")?.addEventListener("change", (ev) => {
      const v = ev.target.value === "market" ? "market" : "limit";
      setOrderType(v);
    });
    document.querySelectorAll("[data-otype]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setOrderType(btn.getAttribute("data-otype"));
        byId("pro-menu")?.classList.add("hidden");
      });
    });
    byId("pro-toggle")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      byId("pro-menu")?.classList.toggle("hidden");
    });
    byId("pro-menu")?.addEventListener("click", (ev) => ev.stopPropagation());
    byId("lev-pop")?.addEventListener("click", (ev) => ev.stopPropagation());
    document.addEventListener("click", () => {
      byId("pro-menu")?.classList.add("hidden");
      byId("lev-pop")?.classList.add("hidden");
      closePicker();
    });
    byId("ticket-mid-btn")?.addEventListener("click", () => {
      const input = byId("ticket-price");
      if (input && Number.isFinite(mid())) input.value = String(mid());
      updateEstimate();
    });
    byId("ticket-max")?.addEventListener("click", () => applyPct(100));
    byId("unit-coin")?.addEventListener("click", () => setUnit("coin"));
    byId("unit-usdc")?.addEventListener("click", () => setUnit("usdc"));
    const range = byId("ticket-pct");
    const box = byId("ticket-pct-box");
    range?.addEventListener("input", () => applyPct(num(range.value) || 0));
    box?.addEventListener("change", () => applyPct(num(box.value) || 0));
    byId("ticket-size")?.addEventListener("input", updateEstimate);
    byId("ticket-price")?.addEventListener("input", updateEstimate);
    byId("ticket-slip")?.addEventListener("input", updateEstimate);
    byId("ticket-tpsl")?.addEventListener("change", () => {
      const on = !!byId("ticket-tpsl")?.checked;
      setTpslOpen(on);
      if (on) syncTpslFromPrices();
    });
    byId("ticket-tp")?.addEventListener("input", () => {
      syncTpslFromPrices();
      updateEstimate();
    });
    byId("ticket-sl")?.addEventListener("input", () => {
      syncTpslFromPrices();
      updateEstimate();
    });
    byId("ticket-tp-gain")?.addEventListener("input", () => {
      applyTpslFromGain("tp");
      updateEstimate();
    });
    byId("ticket-sl-loss")?.addEventListener("input", () => {
      applyTpslFromGain("sl");
      updateEstimate();
    });
    byId("ticket-tp-unit")?.addEventListener("change", () => syncTpslFromPrices());
    byId("ticket-sl-unit")?.addEventListener("change", () => syncTpslFromPrices());
    ["ticket-twap-days", "ticket-twap-hours", "ticket-twap-mins"].forEach((id) => {
      byId(id)?.addEventListener("input", () => syncTwapMinutes());
    });
    byId("lev-toggle")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      byId("lev-pop")?.classList.toggle("hidden");
    });
    byId("lev-range")?.addEventListener("input", () => {
      const inp = byId("lev-input");
      if (inp) inp.value = byId("lev-range").value;
    });
    byId("lev-apply")?.addEventListener("click", applyLeverage);
    byId("mode-isolated")?.addEventListener("click", () => {
      isCross = false;
      byId("mode-isolated")?.setAttribute("aria-pressed", "true");
      byId("mode-cross")?.setAttribute("aria-pressed", "false");
      if (enabled) applyLeverage();
    });
    byId("mode-cross")?.addEventListener("click", () => {
      isCross = true;
      byId("mode-isolated")?.setAttribute("aria-pressed", "false");
      byId("mode-cross")?.setAttribute("aria-pressed", "true");
      if (enabled) applyLeverage();
    });
    const ticketSubmit = byId("ticket-submit");
    if (ticketSubmit) {
      const onTicketConnect = (ev) => {
        if (app.state.address && app.state.source === "wallet") return;
        if (ev && ev._htConnectHandled) return;
        if (ev) ev._htConnectHandled = true;
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        app.connectFromNav && app.connectFromNav();
      };
      ticketSubmit.addEventListener("click", onTicketConnect);
      ticketSubmit.onclick = onTicketConnect;
    }
    byId("ticket-form")?.addEventListener("submit", onSubmit);
    byId("hl-iv")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hl-iv]");
      if (!btn) return;
      setChartInterval(btn.getAttribute("data-hl-iv"));
    });
    document.querySelectorAll("[data-bottom-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        bottomTab = btn.getAttribute("data-bottom-tab");
        document.querySelectorAll("[data-bottom-tab]").forEach((b) => {
          b.setAttribute("aria-selected", b.getAttribute("data-bottom-tab") === bottomTab ? "true" : "false");
        });
        ["balances", "positions", "outcomes", "orders", "twap", "funding", "history"].forEach((id) => {
          byId("trade-" + id)?.classList.toggle("hidden", id !== bottomTab);
        });
        byId("bal-hide-wrap")?.classList.toggle("hidden", bottomTab !== "balances");
        byId("out-filter-wrap")?.classList.toggle("hidden", bottomTab !== "outcomes");
      });
    });
    byId("bal-hide-small")?.addEventListener("change", (ev) => {
      hideSmallBalances = !!ev.target.checked;
      renderBalances();
    });
    document.querySelectorAll("[data-out-side]").forEach((btn) => {
      btn.addEventListener("click", () => {
        outcomeSideFilter = btn.getAttribute("data-out-side") || "all";
        renderOutcomes();
      });
    });
    setSide("buy");
    setOrderType("limit");
    if (!fundingTimer) fundingTimer = setInterval(renderStats, 1000);
  }

  async function initMarkets() {
    markets = await app.loadMarkets();
    marketById = {};
    markets.forEach((m) => {
      marketById[m.id] = m;
      if (m.kind === "outcome") hydrateOutcomePrevDay(m);
    });
    renderMarketSelect();
  }

  return {
    async show(kind) {
      pageKind = kind === "outcome" ? "outcome" : "trade";
      if (pageKind === "outcome") {
        pickerTab = "outcome";
        if (pickerSort === "change" || pickerSort === "funding" || pickerSort === "price") {
          pickerSort = "chance";
          pickerDir = "desc";
        }
      }
      bind();
      if (!markets.length) {
        try {
          await initMarkets();
        } catch (err) {
          ticketMessage("Markets: " + userMessage(err), "err");
        }
      }
      const vis = visibleMarkets();
      const pending = pendingOutcomeSelect;
      pendingOutcomeSelect = null;
      if (pending && pending.marketId) {
        await setMarket(pending.marketId);
        if (pending.side === "No") setOutcomeLeg(1);
        bottomTab = "outcomes";
        document.querySelectorAll("[data-bottom-tab]").forEach((b) => {
          b.setAttribute("aria-selected", b.getAttribute("data-bottom-tab") === bottomTab ? "true" : "false");
        });
        ["balances", "positions", "outcomes", "orders", "twap", "funding", "history"].forEach((id) => {
          byId("trade-" + id)?.classList.toggle("hidden", id !== bottomTab);
        });
        byId("bal-hide-wrap")?.classList.toggle("hidden", true);
        byId("out-filter-wrap")?.classList.toggle("hidden", false);
      } else {
        const keep = vis.find((m) => m.id === marketId);
        await setMarket(keep ? keep.id : vis[0] ? vis[0].id : null);
      }
      subscribeUser();
      refreshEnabled();
      renderBottom();
      if (app.state.address) refreshUserTables();
    },
    onAccount() {
      enabled = false;
      refreshEnabled();
      subscribeUser();
      renderBottom();
      updateEstimate();
      if (app.state.address) refreshUserTables();
    },
    onData() {
      syncLeverageFromPos();
      renderBottom();
      updateEstimate();
    },
    setStatus(text, kind) {
      ticketMessage(text, kind);
    },
  };
}
