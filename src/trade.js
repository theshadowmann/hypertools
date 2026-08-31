import { createChart, CandlestickSeries, ColorType, CrosshairMode } from "lightweight-charts";
import {
  bookLevels,
  candleRange,
  candlesToBars,
  hlInfo,
} from "./api.js";
import {
  escapeHtml,
  fmtPx,
  fmtQty,
  fmtUsd,
  formatClock,
  formatLocalTime,
  num,
  pnlClass,
} from "./format.js";
import { levLabel, positionRows } from "./dashboard.js";
import {
  cancelOrders,
  cancelTwap,
  enableTrading,
  placePerpOrder,
  placeTwapOrder,
  tradingStatus,
  userMessage,
} from "./hl-trade.js";
import { sizeFromMarginPct } from "./order-build.js";

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

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

export function createTradeView(app) {
  const socket = app.socket;
  let markets = [];
  let marketByCoin = {};
  let coin = "BTC";
  let interval = "15m";
  let chart = null;
  let series = null;
  let lastBar = null;
  let unsubCandle = null;
  let unsubBook = null;
  let unsubCtx = null;
  let unsubOrders = null;
  let unsubFills = null;
  let unsubTwap = null;
  let book = { bids: [], asks: [], time: 0 };
  let ctx = { markPx: null, midPx: null, funding: null, oraclePx: null };
  let side = "buy";
  let orderType = "limit";
  let ticketBusy = false;
  let enabled = false;
  let twaps = [];
  let resizeObs = null;

  function currentMarket() {
    return marketByCoin[coin] || markets.find((m) => m.coin === coin) || null;
  }

  function mid() {
    const m = currentMarket();
    const fromCtx = num(ctx.midPx) || num(ctx.markPx);
    if (Number.isFinite(fromCtx) && fromCtx > 0) return fromCtx;
    if (m && num(m.midPx) > 0) return num(m.midPx);
    if (m && num(m.markPx) > 0) return num(m.markPx);
    const mids = app.state.data && app.state.data.mids;
    if (mids && mids[coin]) return num(mids[coin]);
    return NaN;
  }

  function mark() {
    const m = currentMarket();
    const fromCtx = num(ctx.markPx);
    if (Number.isFinite(fromCtx) && fromCtx > 0) return fromCtx;
    if (m && num(m.markPx) > 0) return num(m.markPx);
    return mid();
  }

  function withdrawable() {
    const perps = app.state.data && app.state.data.perps;
    return perps ? num(perps.withdrawable) : NaN;
  }

  function ensureChart() {
    const el = byId("chart");
    if (!el) return;
    if (chart) {
      chart.resize(el.clientWidth, el.clientHeight || 360);
      return;
    }
    chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0b1018" },
        textColor: "#94a3b8",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
    });
    series = chart.addSeries(CandlestickSeries, {
      upColor: "#2dd4bf",
      downColor: "#fb7185",
      borderUpColor: "#2dd4bf",
      borderDownColor: "#fb7185",
      wickUpColor: "#2dd4bf",
      wickDownColor: "#fb7185",
    });
    resizeObs = new ResizeObserver(() => {
      if (chart && el.clientWidth) chart.resize(el.clientWidth, el.clientHeight || 360);
    });
    resizeObs.observe(el);
  }

  async function loadCandles() {
    ensureChart();
    const range = candleRange(interval);
    const rows = await hlInfo({
      type: "candleSnapshot",
      req: { coin, interval, startTime: range.startTime, endTime: range.endTime },
    });
    const bars = candlesToBars(rows);
    lastBar = bars.length ? bars[bars.length - 1] : null;
    if (series) {
      series.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      if (chart) chart.timeScale().fitContent();
    }
  }

  function applyCandleUpdate(data) {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const bars = candlesToBars(rows);
    if (!bars.length || !series) return;
    bars.forEach((bar) => {
      series.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      lastBar = bar;
    });
  }

  function renderBook() {
    const root = byId("book-body");
    if (!root) return;
    const asks = (book.asks || []).slice();
    const bids = (book.bids || []).slice();
    const askView = asks.slice(0, 12).reverse();
    const bidView = bids.slice(0, 12);

    function cum(rows) {
      let s = 0;
      return rows.map((r) => {
        s += num(r.sz) || 0;
        return s;
      });
    }
    const askCum = cum(askView.slice().reverse()).reverse();
    const bidCum = cum(bidView);
    const maxCum = Math.max(askCum[0] || 0, bidCum[bidCum.length - 1] || 0, 1);

    function rowHtml(level, c, kind) {
      const px = level.px;
      const sz = level.sz;
      const width = Math.min(100, (c / maxCum) * 100);
      return (
        '<button type="button" class="book-row ' +
        kind +
        ' w-full px-2 py-0.5 text-[11px] font-mono" data-px="' +
        escapeHtml(String(px)) +
        '">' +
        '<span class="depth" style="width:' +
        width.toFixed(1) +
        '%"></span>' +
        '<span class="' +
        (kind === "ask" ? "text-danger" : "text-accent") +
        ' text-left">' +
        escapeHtml(fmtPx(px, false)) +
        "</span>" +
        '<span class="text-right text-mist-200">' +
        escapeHtml(fmtQty(sz)) +
        "</span>" +
        '<span class="text-right text-mist-400">' +
        escapeHtml(fmtQty(c)) +
        "</span>" +
        "</button>"
      );
    }

    const spread = (() => {
      const bestAsk = asks[0] && num(asks[0].px);
      const bestBid = bids[0] && num(bids[0].px);
      if (!Number.isFinite(bestAsk) || !Number.isFinite(bestBid)) return "—";
      return fmtPx(bestAsk - bestBid, false);
    })();

    if (!askView.length && !bidView.length) {
      root.innerHTML =
        '<p class="px-3 py-8 text-center text-xs text-mist-400">Waiting for live book…</p>';
      return;
    }

    root.innerHTML =
      '<div class="grid grid-cols-3 px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-mist-400">' +
      "<span>Price</span><span class='text-right'>Size</span><span class='text-right'>Sum</span></div>" +
      askView.map((lv, i) => rowHtml(lv, askCum[i], "ask")).join("") +
      '<div class="my-1 flex items-center justify-between border-y border-white/5 px-2 py-1.5 font-mono text-xs">' +
      '<span class="text-white">Spread</span><span class="text-mist-300">' +
      escapeHtml(spread) +
      "</span></div>" +
      bidView.map((lv, i) => rowHtml(lv, bidCum[i], "bid")).join("");

    root.querySelectorAll("[data-px]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const px = btn.getAttribute("data-px");
        const input = byId("ticket-price");
        if (input) input.value = px;
        if (orderType === "market") setOrderType("limit");
        updateEstimate();
      });
    });
  }

  function renderTicker() {
    const m = mid();
    const k = mark();
    setText("trade-mid", Number.isFinite(m) ? fmtPx(m) : "—");
    setText("trade-mark", Number.isFinite(k) ? fmtPx(k) : "—");
    const fund = num(ctx.funding);
    setText(
      "trade-funding",
      Number.isFinite(fund)
        ? (fund * 100).toLocaleString("en-US", { maximumFractionDigits: 4 }) + "%"
        : "—"
    );
    setText("ticket-mid", Number.isFinite(m) ? "Mid " + fmtPx(m) : "Mid —");
    setText("ticket-mark", Number.isFinite(k) ? "Mark " + fmtPx(k) : "Mark —");
    updateEstimate();
  }

  function updateEstimate() {
    const sz = num(fieldValue("ticket-size"));
    let px = orderType === "market" ? mid() : num(fieldValue("ticket-price"));
    if (orderType === "stop") px = num(fieldValue("ticket-trigger")) || px;
    const ntl = Number.isFinite(sz) && Number.isFinite(px) ? sz * px : NaN;
    setText("ticket-notional", Number.isFinite(ntl) ? "Est. " + fmtUsd(ntl) : "Est. —");
    const w = withdrawable();
    setText(
      "ticket-avail",
      Number.isFinite(w) ? "Avail. " + fmtUsd(w) : app.state.address ? "Avail. —" : "Connect wallet for margin"
    );
    const minNote = byId("ticket-min");
    if (minNote) {
      minNote.classList.toggle("hidden", !Number.isFinite(ntl) || ntl >= 10 || sz <= 0);
    }
  }

  function fillPct(pct) {
    const mkt = currentMarket();
    const sz = sizeFromMarginPct(withdrawable(), mark(), pct, mkt ? mkt.szDecimals : 5);
    const input = byId("ticket-size");
    if (input) input.value = sz;
    updateEstimate();
  }

  function setSide(next) {
    side = next;
    const buy = byId("side-buy");
    const sell = byId("side-sell");
    if (buy) buy.setAttribute("aria-pressed", side === "buy" ? "true" : "false");
    if (sell) sell.setAttribute("aria-pressed", side === "sell" ? "true" : "false");
    const submit = byId("ticket-submit");
    if (submit) {
      submit.textContent = (side === "buy" ? "Buy " : "Sell ") + coin;
      submit.classList.toggle("bg-accent", side === "buy");
      submit.classList.toggle("text-ink-950", side === "buy");
      submit.classList.toggle("hover:bg-accent-dim", side === "buy");
      submit.classList.toggle("bg-danger", side === "sell");
      submit.classList.toggle("text-white", side === "sell");
      submit.classList.toggle("hover:bg-rose-500", side === "sell");
    }
  }

  function setOrderType(next) {
    orderType = next;
    const sel = byId("ticket-type");
    if (sel && sel.value !== next) sel.value = next;
    const isLimit = next === "limit";
    const isStop = next === "stop";
    const isTwap = next === "twap";
    const isMarket = next === "market";
    byId("ticket-price-wrap")?.classList.toggle("hidden", isMarket || isTwap || (isStop && byId("ticket-stop-market")?.checked));
    byId("ticket-tif-wrap")?.classList.toggle("hidden", !isLimit);
    byId("ticket-stop-wrap")?.classList.toggle("hidden", !isStop);
    byId("ticket-twap-wrap")?.classList.toggle("hidden", !isTwap);
    updateEstimate();
  }

  function ticketMessage(text, kind) {
    const el = byId("ticket-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("text-danger", "text-accent", "text-mist-400");
    el.classList.add(kind === "err" ? "text-danger" : kind === "ok" ? "text-accent" : "text-mist-400");
  }

  function canTrade() {
    return app.state.source === "wallet" && !!app.state.provider && !!app.state.address;
  }

  function renderTicketLock() {
    const lock = byId("ticket-lock");
    const form = byId("ticket-form");
    const enableBtn = byId("ticket-enable");
    if (!lock || !form) return;
    if (canTrade()) {
      lock.classList.add("hidden");
      form.classList.remove("pointer-events-none", "opacity-40");
      if (enableBtn) enableBtn.classList.toggle("hidden", enabled);
    } else {
      lock.classList.remove("hidden");
      form.classList.add("pointer-events-none", "opacity-40");
      if (app.state.source === "paste") {
        lock.textContent = "Connect a wallet to place or cancel orders. This pasted address can load the account.";
      } else {
        lock.textContent = "Connect a wallet to place Hyperliquid perps orders.";
      }
      if (enableBtn) enableBtn.classList.add("hidden");
    }
  }

  async function refreshEnabled() {
    enabled = false;
    if (!canTrade()) {
      renderTicketLock();
      return;
    }
    try {
      const st = await tradingStatus(app.state.address);
      enabled = !!(st.feeOk && st.agentOk);
    } catch {
      enabled = false;
    }
    renderTicketLock();
  }

  async function onEnable() {
    if (!canTrade()) return;
    ticketBusy = true;
    ticketMessage("Waiting for wallet…");
    try {
      await enableTrading({
        provider: app.state.provider,
        address: app.state.address,
        onStatus: (s) => ticketMessage(s),
      });
      enabled = true;
      ticketMessage("Trading enabled. Orders sign with the approved agent.", "ok");
      renderTicketLock();
    } catch (err) {
      ticketMessage(userMessage(err), "err");
    } finally {
      ticketBusy = false;
    }
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (ticketBusy) return;
    if (!canTrade()) {
      ticketMessage("Connect a wallet to trade.", "err");
      return;
    }
    const mkt = currentMarket();
    if (!mkt) {
      ticketMessage("Select a market.", "err");
      return;
    }
    const size = fieldValue("ticket-size");
    ticketBusy = true;
    const submit = byId("ticket-submit");
    if (submit) submit.disabled = true;
    try {
      if (orderType === "twap") {
        const result = await placeTwapOrder({
          source: app.state.source,
          provider: app.state.provider,
          address: app.state.address,
          market: mkt,
          side,
          size,
          reduceOnly: byId("ticket-reduce")?.checked,
          minutes: fieldValue("ticket-minutes") || 30,
          randomize: byId("ticket-random")?.checked,
          onStatus: (s) => ticketMessage(s),
        });
        ticketMessage(summarizeResult(result), "ok");
      } else {
        const result = await placePerpOrder({
          source: app.state.source,
          provider: app.state.provider,
          address: app.state.address,
          market: mkt,
          side,
          size,
          price: fieldValue("ticket-price"),
          mid: mid(),
          type: orderType,
          tif: fieldValue("ticket-tif") || "Gtc",
          reduceOnly: byId("ticket-reduce")?.checked,
          triggerPx: fieldValue("ticket-trigger"),
          tpsl: fieldValue("ticket-tpsl") || "sl",
          triggerIsMarket: byId("ticket-stop-market")?.checked !== false,
          onStatus: (s) => ticketMessage(s),
        });
        ticketMessage(summarizeResult(result), "ok");
      }
      enabled = true;
      renderTicketLock();
      await refreshUserTables();
      app.reloadAccount && app.reloadAccount();
    } catch (err) {
      ticketMessage(userMessage(err), "err");
    } finally {
      ticketBusy = false;
      if (submit) submit.disabled = false;
    }
  }

  function summarizeResult(result) {
    const statuses = result && result.response && result.response.data && result.response.data.statuses;
    if (Array.isArray(statuses) && statuses[0]) {
      const s = statuses[0];
      if (s.filled) return "Filled " + s.filled.totalSz + " @ " + s.filled.avgPx;
      if (s.resting) return "Resting · oid " + s.resting.oid;
      if (s === "waitingForTrigger") return "Stop accepted, waiting for trigger.";
      if (s === "waitingForFill") return "Waiting for fill.";
    }
    const st = result && result.response && result.response.data && result.response.data.status;
    if (st && st.running) return "TWAP running · id " + st.running.twapId;
    return "Order accepted.";
  }

  function renderMarketSelect() {
    const sel = byId("market-select");
    if (!sel) return;
    const preferred = ["BTC", "ETH", "SOL", "HYPE"];
    const ordered = markets.slice().sort((a, b) => {
      const ia = preferred.indexOf(a.coin);
      const ib = preferred.indexOf(b.coin);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return 0;
    });
    sel.innerHTML = ordered
      .map((m) => {
        const vol = num(m.dayNtlVlm);
        const tag = Number.isFinite(vol) && vol > 0 ? "" : "";
        return (
          '<option value="' +
          escapeHtml(m.coin) +
          '"' +
          (m.coin === coin ? " selected" : "") +
          ">" +
          escapeHtml(m.coin) +
          tag +
          "</option>"
        );
      })
      .join("");
  }

  function renderBottom() {
    renderPositions();
    renderOrders();
    renderFills();
  }

  function renderPositions() {
    const root = byId("trade-positions");
    if (!root) return;
    if (!app.state.address) {
      root.innerHTML = '<p class="px-3 py-6 text-center text-sm text-mist-400">Connect a wallet to trade, or paste an address to load positions.</p>';
      return;
    }
    const perps = (app.state.data && app.state.data.perps) || {};
    const rows = positionRows(perps.assetPositions || []);
    const mids = (app.state.data && app.state.data.mids) || {};
    if (!rows.length) {
      root.innerHTML = '<p class="px-3 py-6 text-center text-sm text-mist-400">No open perps.</p>';
      return;
    }
    root.innerHTML =
      '<div class="overflow-x-auto"><table class="min-w-full text-xs">' +
      '<thead class="text-[10px] uppercase tracking-wider text-mist-400"><tr>' +
      ["Market", "Side", "Size", "Entry", "Mark", "Liq.", "Lev", "uPnL"]
        .map((h) => '<th class="px-2 py-1.5 text-left font-medium">' + h + "</th>")
        .join("") +
      "</tr></thead><tbody>" +
      rows
        .map((p) => {
          const szi = num(p.szi);
          const markPx = mids[p.coin];
          return (
            '<tr class="border-t border-white/5 cursor-pointer hover:bg-white/5" data-coin="' +
            escapeHtml(p.coin) +
            '">' +
            '<td class="px-2 py-1.5 font-medium text-white">' +
            escapeHtml(p.coin) +
            "</td>" +
            '<td class="px-2 py-1.5 ' +
            (szi >= 0 ? "text-accent" : "text-danger") +
            '">' +
            (szi >= 0 ? "Long" : "Short") +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular">' +
            escapeHtml(fmtQty(Math.abs(szi))) +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular">' +
            escapeHtml(fmtPx(p.entryPx)) +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular">' +
            escapeHtml(markPx == null ? "—" : fmtPx(markPx)) +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular">' +
            escapeHtml(p.liquidationPx ? fmtPx(p.liquidationPx) : "—") +
            "</td>" +
            '<td class="px-2 py-1.5">' +
            escapeHtml(levLabel(p.leverage)) +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular ' +
            pnlClass(p.unrealizedPnl) +
            '">' +
            escapeHtml(fmtUsd(p.unrealizedPnl, { signed: true })) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";
    root.querySelectorAll("[data-coin]").forEach((tr) => {
      tr.addEventListener("click", () => setMarket(tr.getAttribute("data-coin")));
    });
  }

  function assetForCoin(c) {
    const m = marketByCoin[c];
    return m ? m.asset : null;
  }

  function renderOrders() {
    const root = byId("trade-orders");
    if (!root) return;
    if (!app.state.address) {
      root.innerHTML = '<p class="px-3 py-6 text-center text-sm text-mist-400">Connect a wallet to trade, or paste an address to load open orders.</p>';
      return;
    }
    const orders = (app.state.data && app.state.data.openOrders) || [];
    const tradeable = canTrade();
    const twapRows = twaps
      .filter((t) => t && (t.status === "activated" || !t.status))
      .map((t) => {
        const st = t.state || t;
        return (
          "<tr class='border-t border-white/5'>" +
          '<td class="px-2 py-1.5 text-white">' +
          escapeHtml(st.coin || "—") +
          "</td>" +
          '<td class="px-2 py-1.5">' +
          escapeHtml(st.side === "B" ? "Buy" : "Sell") +
          "</td>" +
          '<td class="px-2 py-1.5">TWAP</td>' +
          '<td class="px-2 py-1.5 font-mono">' +
          escapeHtml(fmtQty(st.sz)) +
          "</td>" +
          '<td class="px-2 py-1.5 text-mist-400">—</td>' +
          '<td class="px-2 py-1.5 text-mist-400">' +
          escapeHtml(String(st.minutes || "")) +
          "m</td>" +
          "<td class='px-2 py-1.5'>" +
          (tradeable && t.id != null
            ? '<button type="button" class="text-danger hover:underline" data-twap="' +
              t.id +
              '" data-coin="' +
              escapeHtml(st.coin || "") +
              '">Cancel</button>'
            : "") +
          "</td></tr>"
        );
      });

    if (!orders.length && !twapRows.length) {
      root.innerHTML = '<p class="px-3 py-6 text-center text-sm text-mist-400">No open orders.</p>';
      return;
    }
    const rows = orders.map((o) => {
      const sideLabel = o.side === "B" ? "Buy" : "Sell";
      const kind = o.isTrigger ? o.orderType || "Stop" : o.orderType || "Limit";
      return (
        "<tr class='border-t border-white/5'>" +
        '<td class="px-2 py-1.5 font-medium text-white">' +
        escapeHtml(o.coin) +
        "</td>" +
        '<td class="px-2 py-1.5 ' +
        (o.side === "B" ? "text-accent" : "text-danger") +
        '">' +
        sideLabel +
        "</td>" +
        '<td class="px-2 py-1.5">' +
        escapeHtml(kind) +
        "</td>" +
        '<td class="px-2 py-1.5 font-mono tabular">' +
        escapeHtml(fmtQty(o.sz)) +
        "</td>" +
        '<td class="px-2 py-1.5 font-mono tabular">' +
        escapeHtml(fmtPx(o.limitPx)) +
        "</td>" +
        '<td class="px-2 py-1.5 text-mist-400">' +
        escapeHtml(formatClock(o.timestamp)) +
        "</td>" +
        "<td class='px-2 py-1.5'>" +
        (tradeable
          ? '<button type="button" class="text-danger hover:underline" data-oid="' +
            o.oid +
            '" data-coin="' +
            escapeHtml(o.coin) +
            '">Cancel</button>'
          : "") +
        "</td></tr>"
      );
    });
    root.innerHTML =
      '<div class="overflow-x-auto"><table class="min-w-full text-xs">' +
      '<thead class="text-[10px] uppercase tracking-wider text-mist-400"><tr>' +
      ["Market", "Side", "Type", "Size", "Price", "Time", ""]
        .map((h) => '<th class="px-2 py-1.5 text-left font-medium">' + h + "</th>")
        .join("") +
      "</tr></thead><tbody>" +
      rows.join("") +
      twapRows.join("") +
      "</tbody></table></div>";
    root.querySelectorAll("[data-oid]").forEach((btn) => {
      btn.addEventListener("click", () => onCancel(btn.getAttribute("data-coin"), Number(btn.getAttribute("data-oid"))));
    });
    root.querySelectorAll("[data-twap]").forEach((btn) => {
      btn.addEventListener("click", () =>
        onCancelTwap(btn.getAttribute("data-coin"), Number(btn.getAttribute("data-twap")))
      );
    });
  }

  function renderFills() {
    const root = byId("trade-fills");
    if (!root) return;
    if (!app.state.address) {
      root.innerHTML = '<p class="px-3 py-6 text-center text-sm text-mist-400">Connect a wallet to trade, or paste an address to load fills.</p>';
      return;
    }
    const fills = ((app.state.data && app.state.data.fills) || []).slice(0, 30);
    if (!fills.length) {
      root.innerHTML = '<p class="px-3 py-6 text-center text-sm text-mist-400">No recent fills.</p>';
      return;
    }
    root.innerHTML =
      '<div class="overflow-x-auto"><table class="min-w-full text-xs">' +
      '<thead class="text-[10px] uppercase tracking-wider text-mist-400"><tr>' +
      ["Time", "Market", "Dir", "Size", "Price", "Fee"]
        .map((h) => '<th class="px-2 py-1.5 text-left font-medium">' + h + "</th>")
        .join("") +
      "</tr></thead><tbody>" +
      fills
        .map((f) => {
          return (
            "<tr class='border-t border-white/5'>" +
            '<td class="px-2 py-1.5 text-mist-400">' +
            escapeHtml(formatLocalTime(f.time)) +
            "</td>" +
            '<td class="px-2 py-1.5 text-white">' +
            escapeHtml(f.coin) +
            "</td>" +
            '<td class="px-2 py-1.5">' +
            escapeHtml(f.dir || (f.side === "B" ? "Buy" : "Sell")) +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular">' +
            escapeHtml(fmtQty(f.sz)) +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular">' +
            escapeHtml(fmtPx(f.px)) +
            "</td>" +
            '<td class="px-2 py-1.5 font-mono tabular text-mist-300">' +
            escapeHtml(fmtUsd(f.fee)) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";
  }

  async function onCancel(c, oid) {
    if (!canTrade()) {
      ticketMessage("Connect a wallet to cancel orders.", "err");
      return;
    }
    const asset = assetForCoin(c);
    if (asset == null) {
      ticketMessage("Unknown market for cancel.", "err");
      return;
    }
    try {
      ticketMessage("Canceling…");
      await cancelOrders({
        source: app.state.source,
        provider: app.state.provider,
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
    if (!canTrade()) return;
    const asset = assetForCoin(c);
    try {
      await cancelTwap({
        source: app.state.source,
        provider: app.state.provider,
        address: app.state.address,
        asset,
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
      renderBottom();
      return;
    }
    try {
      const [orders, fills] = await Promise.all([
        hlInfo({ type: "frontendOpenOrders", user: app.state.address }),
        hlInfo({ type: "userFills", user: app.state.address }),
      ]);
      if (app.state.data) {
        app.state.data.openOrders = Array.isArray(orders) ? orders : [];
        app.state.data.fills = Array.isArray(fills) ? fills : [];
      }
    } catch {
      /* keep previous */
    }
    renderBottom();
  }

  function clearMarketSubs() {
    if (unsubCandle) unsubCandle();
    if (unsubBook) unsubBook();
    if (unsubCtx) unsubCtx();
    unsubCandle = unsubBook = unsubCtx = null;
  }

  function subscribeMarket() {
    clearMarketSubs();
    book = { bids: [], asks: [], time: 0 };
    renderBook();
    unsubBook = socket.subscribe({ type: "l2Book", coin }, (data) => {
      const next = bookLevels(data);
      book = next;
      renderBook();
    });
    unsubCandle = socket.subscribe({ type: "candle", coin, interval }, (data) => {
      applyCandleUpdate(data);
    });
    unsubCtx = socket.subscribe({ type: "activeAssetCtx", coin }, (data) => {
      const c = data && data.ctx ? data.ctx : data;
      if (!c) return;
      ctx = {
        markPx: c.markPx,
        midPx: c.midPx,
        funding: c.funding,
        oraclePx: c.oraclePx,
      };
      renderTicker();
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
    unsubOrders = socket.subscribe({ type: "orderUpdates", user }, () => {
      refreshUserTables();
    });
    unsubFills = socket.subscribe({ type: "userFills", user }, (data) => {
      if (data && Array.isArray(data.fills) && app.state.data) {
        if (data.isSnapshot) app.state.data.fills = data.fills;
        else app.state.data.fills = data.fills.concat(app.state.data.fills || []).slice(0, 50);
      }
      renderFills();
    });
    unsubTwap = socket.subscribe({ type: "twapStates", user }, (data) => {
      const states = data && (data.states || data);
      if (Array.isArray(states)) {
        twaps = states.map((pair) => {
          if (Array.isArray(pair)) return { id: pair[0], state: pair[1] };
          return pair;
        });
      }
      renderOrders();
    });
  }

  async function setMarket(next) {
    if (!next || !marketByCoin[next]) {
      if (markets.length && !marketByCoin[next]) next = markets[0].coin;
    }
    coin = next || "BTC";
    const sel = byId("market-select");
    if (sel) sel.value = coin;
    setText("trade-coin", coin + "-USD");
    setSide(side);
    ctx = { markPx: null, midPx: null, funding: null, oraclePx: null };
    const m = currentMarket();
    if (m) {
      ctx.markPx = m.markPx;
      ctx.midPx = m.midPx;
      ctx.funding = m.funding;
    }
    renderTicker();
    subscribeMarket();
    try {
      await loadCandles();
    } catch (err) {
      ticketMessage("Chart: " + userMessage(err), "err");
    }
    const snap = await hlInfo({ type: "l2Book", coin }).catch(() => null);
    if (snap) {
      book = bookLevels(snap);
      renderBook();
    }
  }

  function setInterval_(next) {
    interval = next;
    document.querySelectorAll("[data-interval]").forEach((btn) => {
      const on = btn.getAttribute("data-interval") === interval;
      btn.classList.toggle("bg-white/10", on);
      btn.classList.toggle("text-white", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    subscribeMarket();
    loadCandles().catch(() => {});
  }

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    byId("market-select")?.addEventListener("change", (ev) => setMarket(ev.target.value));
    document.querySelectorAll("[data-interval]").forEach((btn) => {
      btn.addEventListener("click", () => setInterval_(btn.getAttribute("data-interval")));
    });
    byId("side-buy")?.addEventListener("click", () => setSide("buy"));
    byId("side-sell")?.addEventListener("click", () => setSide("sell"));
    byId("ticket-type")?.addEventListener("change", (ev) => setOrderType(ev.target.value));
    byId("ticket-size")?.addEventListener("input", updateEstimate);
    byId("ticket-price")?.addEventListener("input", updateEstimate);
    byId("ticket-trigger")?.addEventListener("input", updateEstimate);
    byId("ticket-stop-market")?.addEventListener("change", () => setOrderType(orderType));
    document.querySelectorAll("[data-pct]").forEach((btn) => {
      btn.addEventListener("click", () => fillPct(Number(btn.getAttribute("data-pct"))));
    });
    byId("ticket-form")?.addEventListener("submit", onSubmit);
    byId("ticket-enable")?.addEventListener("click", onEnable);
    document.querySelectorAll("[data-bottom-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-bottom-tab");
        document.querySelectorAll("[data-bottom-tab]").forEach((b) => {
          const on = b.getAttribute("data-bottom-tab") === tab;
          b.classList.toggle("text-white", on);
          b.classList.toggle("bg-white/10", on);
          b.classList.toggle("text-mist-400", !on);
        });
        ["positions", "orders", "fills"].forEach((id) => {
          byId("trade-" + id)?.classList.toggle("hidden", id !== tab);
        });
      });
    });
    setSide("buy");
    setOrderType("limit");
  }

  async function initMarkets() {
    markets = await app.loadMarkets();
    marketByCoin = {};
    markets.forEach((m) => {
      marketByCoin[m.coin] = m;
    });
    if (!marketByCoin[coin] && markets.length) coin = markets[0].coin;
    renderMarketSelect();
  }

  return {
    async show() {
      bind();
      ensureChart();
      if (!markets.length) {
        try {
          await initMarkets();
        } catch (err) {
          ticketMessage("Markets: " + userMessage(err), "err");
        }
      }
      await setMarket(coin);
      subscribeUser();
      renderTicketLock();
      refreshEnabled();
      renderBottom();
      requestAnimationFrame(() => ensureChart());
    },
    onAccount() {
      renderTicketLock();
      refreshEnabled();
      subscribeUser();
      renderBottom();
      updateEstimate();
    },
    onData() {
      renderBottom();
      updateEstimate();
    },
  };
}
