import { createChart, CandlestickSeries, ColorType, CrosshairMode } from "lightweight-charts";
import {
  bookLevels,
  candleRange,
  candlesToBars,
  hlInfo,
} from "./api.js";
import { clear, h, note, ths } from "./dom.js";
import {
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
  let tif = "Gtc";
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
      chart.resize(el.clientWidth, Math.max(el.clientHeight || 0, 1));
      return;
    }
    chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#05070a" },
        textColor: "#64748b",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.035)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        scaleMargins: { top: 0.06, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
      },
    });
    series = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderUpColor: "#0ecb81",
      borderDownColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
    });
    chart.applyOptions({ layout: { attributionLogo: false } });
    resizeObs = new ResizeObserver(() => {
      if (chart && el.clientWidth) {
        chart.resize(el.clientWidth, Math.max(el.clientHeight || 0, 1));
      }
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

  function useBookPrice(px) {
    const input = byId("ticket-price");
    if (input) input.value = String(px);
    if (orderType === "market") setOrderType("limit");
    updateEstimate();
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
      h("span", { class: "px" }, fmtPx(level.px, false)),
      h("span", { class: "sz" }, fmtQty(level.sz)),
      h("span", { class: "sum" }, fmtQty(c))
    );
  }

  function renderBook() {
    const asksEl = byId("book-asks");
    const bidsEl = byId("book-bids");
    if (!asksEl || !bidsEl) return;
    const asks = (book.asks || []).slice();
    const bids = (book.bids || []).slice();
    const depth = 14;
    const askView = asks.slice(0, depth).reverse();
    const bidView = bids.slice(0, depth);

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

    const bestAsk = asks[0] && num(asks[0].px);
    const bestBid = bids[0] && num(bids[0].px);
    let spread = "—";
    if (Number.isFinite(bestAsk) && Number.isFinite(bestBid)) {
      spread = fmtPx(bestAsk - bestBid, false);
    }
    const midPx = mid();
    const spreadEl = byId("book-spread");
    if (spreadEl) {
      clear(spreadEl);
      spreadEl.appendChild(h("span", { class: "text-mist-400" }, "Spread " + spread));
      spreadEl.appendChild(
        h("span", { class: "text-white" }, Number.isFinite(midPx) ? fmtPx(midPx, false) : "—")
      );
    }

    clear(asksEl);
    clear(bidsEl);
    if (!askView.length && !bidView.length) {
      asksEl.appendChild(note("Waiting for live book…", "px-3 py-6 text-center text-[11px] text-mist-400"));
      return;
    }
    askView.forEach((lv, i) => asksEl.appendChild(bookRow(lv, askCum[i], "ask", maxCum)));
    bidView.forEach((lv, i) => bidsEl.appendChild(bookRow(lv, bidCum[i], "bid", maxCum)));
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
    renderBook();
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
      submit.classList.toggle("buy", side === "buy");
      submit.classList.toggle("sell", side === "sell");
    }
  }

  function setOrderType(next) {
    orderType = next;
    const isLimit = next === "limit";
    const isStop = next === "stop";
    const isTwap = next === "twap";
    const isMarket = next === "market";
    document.querySelectorAll("[data-otype]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-otype") === next ? "true" : "false");
    });
    const advanced = byId("ticket-advanced");
    if (advanced && (isStop || isTwap)) advanced.classList.remove("hidden");
    byId("ticket-price-wrap")?.classList.toggle("hidden", isMarket || isTwap || (isStop && byId("ticket-stop-market")?.checked));
    byId("ticket-tif-wrap")?.classList.toggle("hidden", !isLimit);
    byId("ticket-stop-wrap")?.classList.toggle("hidden", !isStop);
    byId("ticket-twap-wrap")?.classList.toggle("hidden", !isTwap);
    updateEstimate();
  }

  function setTif(next) {
    tif = next;
    const hidden = byId("ticket-tif");
    if (hidden) hidden.value = next;
    document.querySelectorAll("[data-tif]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-tif") === next ? "true" : "false");
    });
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

  function renderTicketLock() {
    const lock = byId("ticket-lock");
    const enableBtn = byId("ticket-enable");
    const submit = byId("ticket-submit");
    if (!lock) return;
    if (canTrade()) {
      lock.classList.add("hidden");
      if (enableBtn) enableBtn.classList.toggle("hidden", enabled);
      if (submit) submit.disabled = !enabled || ticketBusy;
    } else {
      lock.classList.remove("hidden");
      if (app.state.source === "paste") {
        lock.textContent = "Connect a wallet to place or cancel orders. This pasted address can load the account.";
      } else {
        lock.textContent = "Connect a wallet to place Hyperliquid perps orders.";
      }
      if (enableBtn) enableBtn.classList.add("hidden");
      if (submit) submit.disabled = true;
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
    if (!canTrade() || ticketBusy) return;
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
      renderTicketLock();
    }
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (ticketBusy) return;
    if (!canTrade()) {
      ticketMessage("Connect a wallet to trade.", "err");
      return;
    }
    if (!enabled) {
      ticketMessage("Click Enable trading first.", "err");
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
          address: app.state.address,
          market: mkt,
          side,
          size,
          price: fieldValue("ticket-price"),
          mid: mid(),
          type: orderType,
          tif: tif || "Gtc",
          reduceOnly: byId("ticket-reduce")?.checked,
          triggerPx: fieldValue("ticket-trigger"),
          tpsl: fieldValue("ticket-tpsl") || "sl",
          triggerIsMarket: byId("ticket-stop-market")?.checked !== false,
          onStatus: (s) => ticketMessage(s),
        });
        ticketMessage(summarizeResult(result), "ok");
      }
      await refreshUserTables();
      app.reloadAccount && app.reloadAccount();
    } catch (err) {
      ticketMessage(userMessage(err), "err");
    } finally {
      ticketBusy = false;
      renderTicketLock();
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
    clear(sel);
    ordered.forEach((m) => {
      sel.appendChild(
        h("option", { value: m.coin, selected: m.coin === coin }, m.coin)
      );
    });
  }

  function renderBottom() {
    renderPositions();
    renderOrders();
    renderFills();
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
    const body = rows.map((p) => {
      const szi = num(p.szi);
      const markPx = mids[p.coin];
      return h(
        "tr",
        {
          class: "border-t border-white/5 cursor-pointer hover:bg-white/5",
          onClick: () => setMarket(p.coin),
        },
        h("td", { class: "px-2 py-1.5 font-medium text-white" }, p.coin),
        h("td", { class: "px-2 py-1.5 " + (szi >= 0 ? "text-buy" : "text-sell") }, szi >= 0 ? "Long" : "Short"),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, fmtQty(Math.abs(szi))),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, fmtPx(p.entryPx)),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, markPx == null ? "—" : fmtPx(markPx)),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, p.liquidationPx ? fmtPx(p.liquidationPx) : "—"),
        h("td", { class: "px-2 py-1.5" }, levLabel(p.leverage)),
        h(
          "td",
          { class: "px-2 py-1.5 font-mono tabular " + pnlClass(p.unrealizedPnl) },
          fmtUsd(p.unrealizedPnl, { signed: true })
        )
      );
    });
    root.appendChild(
      h(
        "div",
        { class: "overflow-x-auto" },
        h(
          "table",
          { class: "min-w-full text-xs" },
          h(
            "thead",
            { class: "text-[10px] uppercase tracking-wider text-mist-400" },
            h("tr", null, ...ths(["Market", "Side", "Size", "Entry", "Mark", "Liq.", "Lev", "uPnL"], "px-2 py-1.5 text-left font-medium"))
          ),
          h("tbody", null, ...body)
        )
      )
    );
  }

  function assetForCoin(c) {
    const m = marketByCoin[c];
    return m ? m.asset : null;
  }

  function renderOrders() {
    const root = byId("trade-orders");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load open orders."));
      return;
    }
    const orders = (app.state.data && app.state.data.openOrders) || [];
    const tradeable = canTrade();
    const twapRows = twaps
      .filter((t) => t && (t.status === "activated" || !t.status))
      .map((t) => {
        const st = t.state || t;
        const cancelBtn =
          tradeable && t.id != null
            ? h(
                "button",
                {
                  type: "button",
                  class: "text-sell hover:underline",
                  onClick: () => onCancelTwap(st.coin || "", Number(t.id)),
                },
                "Cancel"
              )
            : "";
        return h(
          "tr",
          { class: "border-t border-white/5" },
          h("td", { class: "px-2 py-1.5 text-white" }, st.coin || "—"),
          h("td", { class: "px-2 py-1.5" }, st.side === "B" ? "Buy" : "Sell"),
          h("td", { class: "px-2 py-1.5" }, "TWAP"),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(st.sz)),
          h("td", { class: "px-2 py-1.5 text-mist-400" }, "—"),
          h("td", { class: "px-2 py-1.5 text-mist-400" }, String(st.minutes || "") + "m"),
          h("td", { class: "px-2 py-1.5" }, cancelBtn)
        );
      });

    if (!orders.length && !twapRows.length) {
      root.appendChild(emptyNote("No open orders."));
      return;
    }
    const rows = orders.map((o) => {
      const sideLabel = o.side === "B" ? "Buy" : "Sell";
      const kind = o.isTrigger ? o.orderType || "Stop" : o.orderType || "Limit";
      const cancelBtn = tradeable
        ? h(
            "button",
            {
              type: "button",
              class: "text-sell hover:underline",
              onClick: () => onCancel(o.coin, Number(o.oid)),
            },
            "Cancel"
          )
        : "";
      return h(
        "tr",
        { class: "border-t border-white/5" },
        h("td", { class: "px-2 py-1.5 font-medium text-white" }, o.coin),
        h("td", { class: "px-2 py-1.5 " + (o.side === "B" ? "text-buy" : "text-sell") }, sideLabel),
        h("td", { class: "px-2 py-1.5" }, kind),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, fmtQty(o.sz)),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, fmtPx(o.limitPx)),
        h("td", { class: "px-2 py-1.5 text-mist-400" }, formatClock(o.timestamp)),
        h("td", { class: "px-2 py-1.5" }, cancelBtn)
      );
    });
    root.appendChild(
      h(
        "div",
        { class: "overflow-x-auto" },
        h(
          "table",
          { class: "min-w-full text-xs" },
          h(
            "thead",
            { class: "text-[10px] uppercase tracking-wider text-mist-400" },
            h("tr", null, ...ths(["Market", "Side", "Type", "Size", "Price", "Time", ""], "px-2 py-1.5 text-left font-medium"))
          ),
          h("tbody", null, ...rows, ...twapRows)
        )
      )
    );
  }

  function renderFills() {
    const root = byId("trade-fills");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load fills."));
      return;
    }
    const fills = ((app.state.data && app.state.data.fills) || []).slice(0, 30);
    if (!fills.length) {
      root.appendChild(emptyNote("No recent fills."));
      return;
    }
    const rows = fills.map((f) =>
      h(
        "tr",
        { class: "border-t border-white/5" },
        h("td", { class: "px-2 py-1.5 text-mist-400" }, formatLocalTime(f.time)),
        h("td", { class: "px-2 py-1.5 text-white" }, f.coin),
        h("td", { class: "px-2 py-1.5" }, f.dir || (f.side === "B" ? "Buy" : "Sell")),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, fmtQty(f.sz)),
        h("td", { class: "px-2 py-1.5 font-mono tabular" }, fmtPx(f.px)),
        h("td", { class: "px-2 py-1.5 font-mono tabular text-mist-300" }, fmtUsd(f.fee))
      )
    );
    root.appendChild(
      h(
        "div",
        { class: "overflow-x-auto" },
        h(
          "table",
          { class: "min-w-full text-xs" },
          h(
            "thead",
            { class: "text-[10px] uppercase tracking-wider text-mist-400" },
            h("tr", null, ...ths(["Time", "Market", "Dir", "Size", "Price", "Fee"], "px-2 py-1.5 text-left font-medium"))
          ),
          h("tbody", null, ...rows)
        )
      )
    );
  }

  async function onCancel(c, oid) {
    if (!canTrade()) {
      ticketMessage("Connect a wallet to cancel orders.", "err");
      return;
    }
    if (!enabled) {
      ticketMessage("Click Enable trading first.", "err");
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
    if (!enabled) {
      ticketMessage("Click Enable trading first.", "err");
      return;
    }
    const asset = assetForCoin(c);
    try {
      await cancelTwap({
        source: app.state.source,
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
    document.querySelectorAll("[data-otype]").forEach((btn) => {
      btn.addEventListener("click", () => setOrderType(btn.getAttribute("data-otype")));
    });
    document.querySelectorAll("[data-tif]").forEach((btn) => {
      btn.addEventListener("click", () => setTif(btn.getAttribute("data-tif")));
    });
    byId("ticket-advanced-toggle")?.addEventListener("click", () => {
      byId("ticket-advanced")?.classList.toggle("hidden");
    });
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
    setTif("Gtc");
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
      enabled = false;
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
