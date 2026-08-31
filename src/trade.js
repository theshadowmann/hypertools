import {
  bookLevels,
  hlInfo,
  loadTradeExtras,
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
  fundingCountdown,
  marginRequired,
  orderValue,
  sizeFromAvailablePct,
} from "./ticket-math.js";
import { mountTvChart } from "./tv-chart.js";

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
  let unsubBook = null;
  let unsubCtx = null;
  let unsubOrders = null;
  let unsubFills = null;
  let unsubTwap = null;
  let book = { bids: [], asks: [], time: 0 };
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
  let fundingTimer = null;
  let lastTv = "";

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

  function currentPos() {
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
    const key = coin + "|" + interval;
    if (key === lastTv && byId("chart") && byId("chart").firstChild) return;
    lastTv = key;
    mountTvChart(byId("chart"), { coin, interval });
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
    const askView = asks.slice(0, 14).reverse();
    const bidView = bids.slice(0, 14);
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
    if (Number.isFinite(bestAsk) && Number.isFinite(bestBid)) spread = fmtPx(bestAsk - bestBid, false);
    const spreadEl = byId("book-spread");
    if (spreadEl) {
      clear(spreadEl);
      spreadEl.appendChild(h("span", { class: "text-mist-400" }, "Spread " + spread));
      spreadEl.appendChild(h("span", { class: "text-white" }, Number.isFinite(mid()) ? fmtPx(mid(), false) : "—"));
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

  function renderStats() {
    const mkt = currentMarket();
    const k = mark();
    const oracle = num(ctx.oraclePx) || (mkt && num(mkt.oraclePx));
    const vol = num(ctx.dayNtlVlm) || (mkt && num(mkt.dayNtlVlm));
    const oi = num(ctx.openInterest) || (mkt && num(mkt.openInterest));
    const prev = num(ctx.prevDayPx) || (mkt && num(mkt.prevDayPx));
    const ch = change24h(k, prev);
    const chEl = byId("stat-change");
    if (chEl) {
      chEl.textContent = Number.isFinite(ch)
        ? (ch * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"
        : "—";
      chEl.classList.toggle("up", Number.isFinite(ch) && ch > 0);
      chEl.classList.toggle("down", Number.isFinite(ch) && ch < 0);
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
    const power = buyingPower(w, leverage);
    setText("ticket-avail", Number.isFinite(w) ? fmtUsd(power) + " USDC" : "— USDC");
    const pos = currentPos();
    const posSz = pos ? num(pos.szi) : 0;
    setText("ticket-pos", pos && posSz ? fmtQty(Math.abs(posSz)) + " " + coin : "0.00000 " + coin);
    const liq = estimateLiqPx(mark(), leverage, side === "buy");
    setText("sum-liq", Number.isFinite(liq) ? fmtPx(liq) : "—");
    setText("sum-value", Number.isFinite(ntl) ? fmtUsd(ntl) : "—");
    setText("sum-margin", Number.isFinite(ntl) ? fmtUsd(marginRequired(ntl, leverage)) : "—");
    const slip = estimateSlippage(orderType === "market" ? mark() : num(fieldValue("ticket-price")), mid(), orderType === "market" || orderType === "stop-market");
    setText("sum-slip-est", "Est. " + (slip * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%");
    const fees = extras.userFees;
    if (fees) {
      setText("sum-fees", "Taker " + formatFeePct(fees.userCrossRate) + " · Maker " + formatFeePct(fees.userAddRate));
    } else {
      setText("sum-fees", "—");
    }
    const minNote = byId("ticket-min");
    if (minNote) minNote.classList.toggle("hidden", !Number.isFinite(ntl) || ntl >= 10 || !(sz > 0));
    if (mkt) {
      const unitCoin = byId("unit-coin");
      if (unitCoin) unitCoin.textContent = mkt.coin;
    }
    renderTicketButton();
  }

  function applyPct(pct) {
    const mkt = currentMarket();
    const sz = sizeFromAvailablePct(
      buyingPower(withdrawable(), leverage),
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
      sell.classList.toggle("short", side === "sell");
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
    const proBtn = byId("pro-toggle");
    if (proBtn) {
      proBtn.setAttribute("aria-pressed", proOn ? "true" : "false");
      proBtn.textContent = proOn
        ? { scale: "Scale", twap: "TWAP", "stop-limit": "Stop Limit", "stop-market": "Stop Market" }[next]
        : "Pro";
    }
    byId("ticket-price-wrap")?.classList.toggle("hidden", next === "market" || next === "twap" || next === "stop-market");
    byId("ticket-amount-wrap")?.classList.toggle("hidden", false);
    byId("ticket-scale-wrap")?.classList.toggle("hidden", next !== "scale");
    byId("ticket-twap-wrap")?.classList.toggle("hidden", next !== "twap");
    byId("ticket-stop-wrap")?.classList.toggle("hidden", next !== "stop-limit" && next !== "stop-market");
    byId("ticket-stop-limit-price")?.classList.toggle("hidden", next !== "stop-limit");
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
      submit.textContent = "Connect wallet";
      submit.disabled = false;
      submit.classList.toggle("buy", side === "buy");
      submit.classList.toggle("sell", side === "sell");
      return;
    }
    if (!enabled) {
      submit.textContent = "Enable trading";
      submit.disabled = ticketBusy;
      return;
    }
    submit.disabled = ticketBusy;
    const verb = side === "buy" ? "Buy" : "Sell";
    submit.textContent = verb + " " + coin;
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
          minutes: fieldValue("ticket-minutes") || 30,
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
          tif: orderType === "market" || orderType === "stop-market" ? "Ioc" : "Gtc",
          triggerPx: fieldValue("ticket-trigger"),
          tpsl: "sl",
          triggerIsMarket: orderType !== "stop-limit",
          maxSlippage: maxSlippage(),
          extraOrders: tpsl,
          grouping: tpsl.length ? "normalTpsl" : "na",
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
    ordered.forEach((m) => sel.appendChild(h("option", { value: m.coin, selected: m.coin === coin }, m.coin)));
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
        { class: "min-w-full text-xs" },
        h("thead", { class: "text-[10px] uppercase tracking-wider text-mist-400" }, h("tr", null, ...ths(headers, "px-2 py-1.5 text-left font-medium"))),
        h("tbody", null, ...rows)
      )
    );
  }

  function renderBalances() {
    const root = byId("trade-balances");
    if (!root) return;
    clear(root);
    if (!app.state.address) {
      root.appendChild(emptyNote("Connect a wallet to trade, or paste an address to load balances."));
      return;
    }
    const perps = (app.state.data && app.state.data.perps) || {};
    const spot = ((app.state.data && app.state.data.spot && app.state.data.spot.balances) || []).filter((b) => Math.abs(num(b.total)) > 1e-8);
    const usdc = spotUsdcParts(spot);
    const rows = [
      h(
        "tr",
        { class: "border-t border-white/5" },
        h("td", { class: "px-2 py-1.5 text-white" }, "Perps USDC"),
        h("td", { class: "px-2 py-1.5 font-mono" }, fmtUsd(perps.marginSummary && perps.marginSummary.accountValue)),
        h("td", { class: "px-2 py-1.5 font-mono" }, fmtUsd(perps.withdrawable))
      ),
    ];
    spot.forEach((b) => {
      rows.push(
        h(
          "tr",
          { class: "border-t border-white/5" },
          h("td", { class: "px-2 py-1.5 text-white" }, b.coin || "—"),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(b.total)),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtQty(Math.max(0, num(b.total) - num(b.hold))))
        )
      );
    });
    if (!spot.length) {
      rows.push(
        h(
          "tr",
          { class: "border-t border-white/5" },
          h("td", { class: "px-2 py-1.5 text-white" }, "Spot USDC"),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtUsd(usdc.total)),
          h("td", { class: "px-2 py-1.5 font-mono" }, fmtUsd(usdc.available))
        )
      );
    }
    root.appendChild(histTable(["Asset", "Total", "Available"], rows));
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
            { class: "border-t border-white/5 cursor-pointer hover:bg-white/5", onClick: () => setMarket(p.coin) },
            h("td", { class: "px-2 py-1.5 font-medium text-white" }, p.coin),
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
    if (!orders.length) {
      root.appendChild(emptyNote("No open orders."));
      return;
    }
    root.appendChild(
      histTable(
        ["Time", "Coin", "Direction", "Size", "Filled Size", "Order Value", "Price", "Reduce Only", "Trigger Conditions", "Status", "Order ID", ""],
        orders.map((o) =>
          h(
            "tr",
            { class: "border-t border-white/5" },
            h("td", { class: "px-2 py-1.5 text-mist-400" }, formatClock(o.timestamp)),
            h("td", { class: "px-2 py-1.5 text-white" }, o.coin),
            h("td", { class: "px-2 py-1.5 " + (o.side === "B" ? "text-buy" : "text-sell") }, o.side === "B" ? "Open Long" : "Open Short"),
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
          )
        )
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
    const hist = extras.twapHistory || [];
    const fills = extras.twapFills || [];
    const live = twaps || [];
    if (!hist.length && !live.length && !fills.length) {
      root.appendChild(emptyNote("No TWAP orders."));
      return;
    }
    const rows = [];
    live.forEach((t) => {
      const st = t.state || t;
      rows.push(
        h(
          "tr",
          { class: "border-t border-white/5" },
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
          { class: "border-t border-white/5" },
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
          { class: "border-t border-white/5" },
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
            { class: "border-t border-white/5" },
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
            { class: "border-t border-white/5" },
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
    if (unsubBook) unsubBook();
    if (unsubCtx) unsubCtx();
    unsubBook = unsubCtx = null;
    book = { bids: [], asks: [], time: 0 };
    renderBook();
    unsubBook = socket.subscribe({ type: "l2Book", coin }, (data) => {
      book = bookLevels(data);
      renderBook();
    });
    unsubCtx = socket.subscribe({ type: "activeAssetCtx", coin }, (data) => {
      const c = data && data.ctx ? data.ctx : data;
      if (!c) return;
      ctx = {
        markPx: c.markPx,
        midPx: c.midPx,
        funding: c.funding,
        oraclePx: c.oraclePx,
        dayNtlVlm: c.dayNtlVlm,
        openInterest: c.openInterest,
        prevDayPx: c.prevDayPx,
      };
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
    if (!next || !marketByCoin[next]) {
      if (markets.length && !marketByCoin[next]) next = markets[0].coin;
    }
    coin = next || "BTC";
    const sel = byId("market-select");
    if (sel) sel.value = coin;
    setText("trade-coin", coin);
    setUnit(unit === "usdc" ? "usdc" : "coin");
    const m = currentMarket();
    ctx = {
      markPx: m && m.markPx,
      midPx: m && m.midPx,
      funding: m && m.funding,
      oraclePx: m && m.oraclePx,
      dayNtlVlm: m && m.dayNtlVlm,
      openInterest: m && m.openInterest,
      prevDayPx: m && m.prevDayPx,
    };
    syncLeverageFromPos();
    renderStats();
    updateEstimate();
    ensureChart();
    subscribeMarket();
    const snap = await hlInfo({ type: "l2Book", coin }).catch(() => null);
    if (snap) {
      book = bookLevels(snap);
      renderBook();
    }
  }

  function setInterval_(next) {
    interval = next;
    document.querySelectorAll("[data-interval]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-interval") === interval ? "true" : "false");
    });
    ensureChart();
    subscribeMarket();
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
      byId("ticket-tpsl-wrap")?.classList.toggle("hidden", !byId("ticket-tpsl")?.checked);
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
    byId("ticket-form")?.addEventListener("submit", onSubmit);
    document.querySelectorAll("[data-bottom-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        bottomTab = btn.getAttribute("data-bottom-tab");
        document.querySelectorAll("[data-bottom-tab]").forEach((b) => {
          b.setAttribute("aria-selected", b.getAttribute("data-bottom-tab") === bottomTab ? "true" : "false");
        });
        ["balances", "positions", "orders", "twap", "funding", "history"].forEach((id) => {
          byId("trade-" + id)?.classList.toggle("hidden", id !== bottomTab);
        });
      });
    });
    setSide("buy");
    setOrderType("limit");
    if (!fundingTimer) fundingTimer = setInterval(renderStats, 1000);
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
      if (!markets.length) {
        try {
          await initMarkets();
        } catch (err) {
          ticketMessage("Markets: " + userMessage(err), "err");
        }
      }
      await setMarket(coin);
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
  };
}
