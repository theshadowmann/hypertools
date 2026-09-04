import { clear, h, note } from "./dom.js";
import {
  fmtHype,
  fmtPx,
  fmtQty,
  fmtUsd,
  formatLocalTime,
  num,
  pnlClass,
} from "./format.js";
import { formatFeePct } from "./ticket-math.js";
import { buildBalanceRows, formatPnlPct } from "./balances.js";
import { outcomePositionMetrics, outcomePositionsFromSpot } from "./outcomes.js";
import {
  axisTicks,
  chartSeries,
  chartTickUsd,
  chartXOf,
  formatChartDate,
  formatScrubberTip,
  lastPnl,
  portChartLayout,
  snapChartPointByT,
  snapChartPointByX,
  missingMoney,
  parsePortfolio,
  periodVolume,
  perpsEquity,
  PORT_ACCOUNTS,
  PORT_CHARTS,
  PORT_PERIODS,
  spotEquityUsd,
  stakingUsd,
  summaryBlock,
  sum14DayVolume,
  sumVaultEquity,
  upnlSum,
} from "./port-summary.js";

export { spotUsdcParts } from "./balances.js";

export function positionRows(assetPositions) {
  const rows = [];
  (assetPositions || []).forEach((ap) => {
    const p = ap && ap.position;
    if (!p || p.szi == null) return;
    const szi = num(p.szi);
    if (!Number.isFinite(szi) || szi === 0) return;
    rows.push(p);
  });
  rows.sort((a, b) => Math.abs(num(b.positionValue)) - Math.abs(num(a.positionValue)));
  return rows;
}

export function levLabel(lev) {
  if (!lev) return "—";
  const v = lev.value;
  const t = lev.type || "";
  if (v == null || v === "") return t || "—";
  return String(v) + "x " + t;
}

export const POS_HEADERS = ["MARKET", "SIDE", "SIZE", "ENTRY", "MARK", "LIQ.", "LEV", "UPNL"];

export function buildPositionsTable(rows, mids, opts = {}) {
  const marks = mids || {};
  return h(
    "div",
    { class: "overflow-x-auto" },
    h(
      "table",
      { class: "bal-table pos-table" },
      h("thead", null, h("tr", null, ...POS_HEADERS.map((label) => h("th", null, label)))),
      h(
        "tbody",
        null,
        ...rows.map((p) => {
          const szi = num(p.szi);
          const long = szi >= 0;
          const trAttrs = {};
          if (opts.rowClass) trAttrs.class = opts.rowClass;
          if (typeof opts.onRowClick === "function") trAttrs.onClick = () => opts.onRowClick(p);
          return h(
            "tr",
            Object.keys(trAttrs).length ? trAttrs : null,
            h("td", null, p.coin),
            h("td", { class: long ? "text-accent" : "text-danger" }, long ? "Long" : "Short"),
            h("td", null, fmtQty(Math.abs(szi))),
            h("td", null, fmtPx(p.entryPx)),
            h("td", null, marks[p.coin] == null ? "—" : fmtPx(marks[p.coin])),
            h("td", null, p.liquidationPx ? fmtPx(p.liquidationPx) : "—"),
            h("td", null, levLabel(p.leverage)),
            h("td", { class: pnlClass(p.unrealizedPnl) }, fmtUsd(p.unrealizedPnl, { signed: true }))
          );
        })
      )
    )
  );
}

function money(v) {
  if (v == null || !Number.isFinite(Number(v))) return missingMoney();
  return fmtUsd(v);
}

function moneySigned(v) {
  if (v == null || !Number.isFinite(Number(v))) return missingMoney();
  return fmtUsd(v, { signed: true });
}

function feeTxt(connected, fees, rate) {
  if (!connected || !fees) return missingMoney();
  const s = formatFeePct(rate);
  return s === "—" ? missingMoney() : s;
}

function stakeText(connected, staking, hypePx) {
  if (!connected) return missingMoney();
  const usd = stakingUsd(staking, hypePx);
  if (usd != null) return money(usd);
  if (staking && staking.delegated != null && staking.delegated !== "") {
    const hype = fmtHype(staking.delegated);
    return hype === "—" ? missingMoney() : hype;
  }
  return missingMoney();
}

let portPeriod = "week";
let portChart = "pnl";
let portAcct = "all";
let portHistTab = "balances";
let portHideSmall = true;
let chartResizeBound = false;
let portMenuDocBound = false;

function closePortMenus() {
  ["port-tf-menu", "port-acct-menu"].forEach((id) => {
    const menu = document.getElementById(id);
    if (!menu) return;
    menu.classList.add("hidden");
    menu.setAttribute("hidden", "");
  });
  ["port-tf-btn", "port-acct-btn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function togglePortMenu(btnId, menuId, ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById(menuId);
  const btn = document.getElementById(btnId);
  if (!menu || !btn) return;
  const open = menu.classList.contains("hidden");
  closePortMenus();
  if (open) {
    menu.classList.remove("hidden");
    menu.removeAttribute("hidden");
    btn.setAttribute("aria-expanded", "true");
  }
}

function syncPortChrome() {
  document.querySelectorAll("[data-port-chart]").forEach((b) => {
    b.setAttribute("aria-selected", b.getAttribute("data-port-chart") === portChart ? "true" : "false");
  });
  const tfLabel = document.getElementById("port-tf-label");
  const tf = PORT_PERIODS.find((p) => p.id === portPeriod);
  if (tfLabel && tf) tfLabel.textContent = tf.label;
  document.querySelectorAll("[data-port-period]").forEach((b) => {
    b.classList.toggle("is-on", b.getAttribute("data-port-period") === portPeriod);
  });
  const acct = PORT_ACCOUNTS.find((a) => a.id === portAcct) || PORT_ACCOUNTS[1];
  const acctLabel = document.getElementById("port-acct-label");
  if (acctLabel && acct) acctLabel.textContent = acct.label;
  document.querySelectorAll("[data-port-acct]").forEach((b) => {
    const on = b.getAttribute("data-port-acct") === portAcct;
    b.classList.toggle("is-on", on);
    const check = b.querySelector(".port-check");
    if (check) {
      if (on) check.removeAttribute("hidden");
      else check.setAttribute("hidden", "");
    }
  });
}

function bindPortHistOnce() {
  const dash = document.getElementById("dashboard");
  if (!dash || dash.dataset.portBound === "1") return;
  dash.dataset.portBound = "1";
  dash.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest(".port-menu-wrap") && dash.contains(t.closest(".port-menu-wrap"))) ev.stopPropagation();

    const tfBtn = t.closest("#port-tf-btn");
    if (tfBtn && dash.contains(tfBtn)) {
      togglePortMenu("port-tf-btn", "port-tf-menu", ev);
      return;
    }
    const acctBtn = t.closest("#port-acct-btn");
    if (acctBtn && dash.contains(acctBtn)) {
      togglePortMenu("port-acct-btn", "port-acct-menu", ev);
      return;
    }

    const periodBtn = t.closest("[data-port-period]");
    if (periodBtn && dash.contains(periodBtn)) {
      const next = periodBtn.getAttribute("data-port-period");
      if (PORT_PERIODS.some((p) => p.id === next)) portPeriod = next;
      closePortMenus();
      if (dash._lastState) renderDashboard(dash._lastEl || {}, dash._lastState);
      return;
    }
    const acctItem = t.closest("[data-port-acct]");
    if (acctItem && dash.contains(acctItem)) {
      const next = acctItem.getAttribute("data-port-acct") || "";
      closePortMenus();
      if (PORT_ACCOUNTS.some((a) => a.id === next)) {
        portAcct = next;
        if (dash._lastState) renderDashboard(dash._lastEl || {}, dash._lastState);
      }
      return;
    }
    const chartTab = t.closest("[data-port-chart]");
    if (chartTab && dash.contains(chartTab)) {
      const next = chartTab.getAttribute("data-port-chart");
      if (PORT_CHARTS.some((c) => c.id === next)) portChart = next;
      if (dash._lastState) renderDashboard(dash._lastEl || {}, dash._lastState);
      return;
    }

    const btn = t.closest("[data-port-tab]");
    if (!btn || !dash.contains(btn)) return;
    portHistTab = btn.getAttribute("data-port-tab") || "balances";
    dash.querySelectorAll("[data-port-tab]").forEach((b) => {
      b.setAttribute("aria-selected", b.getAttribute("data-port-tab") === portHistTab ? "true" : "false");
    });
    ["balances", "positions", "outcomes", "orders", "twap", "funding", "history"].forEach((id) => {
      const pane = document.getElementById("port-" + id);
      if (pane) pane.classList.toggle("hidden", id !== portHistTab);
    });
    const hideWrap = document.getElementById("port-bal-hide-wrap");
    if (hideWrap) hideWrap.classList.toggle("hidden", portHistTab !== "balances");
  });
  dash.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.id === "port-bal-hide-small") {
      portHideSmall = !!t.checked;
      if (dash._lastState) renderPortHist(dash._lastState);
    }
  });
  if (!portMenuDocBound && typeof document !== "undefined") {
    portMenuDocBound = true;
    document.addEventListener("click", (ev) => {
      const node = ev.target;
      if (node && node.closest && node.closest(".port-menu-wrap")) return;
      closePortMenus();
    });
  }
}

function pointerCanvasX(ev, canvas) {
  const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0 };
  const src =
    ev && ev.touches && ev.touches[0]
      ? ev.touches[0]
      : ev && ev.changedTouches && ev.changedTouches[0]
        ? ev.changedTouches[0]
        : ev;
  const clientX = src && Number.isFinite(src.clientX) ? src.clientX : 0;
  return clientX - (r.left || 0);
}

function scrubFromPointer(canvas, ev) {
  const pts = canvas && canvas._series;
  const layout = canvas && canvas._layout;
  if (!canvas || !pts || !pts.length || !layout) return;
  const pt = snapChartPointByX(pts, layout, pointerCanvasX(ev, canvas));
  if (!pt) return;
  canvas._scrubT = pt.t;
  drawPnlChart(canvas, pts);
}

function bindChartPointer(canvas) {
  if (!canvas || canvas._scrubBound) return;
  canvas._scrubBound = true;
  const move = (ev) => {
    if (ev && ev.cancelable && ev.pointerType === "touch") ev.preventDefault();
    scrubFromPointer(canvas, ev);
  };
  canvas.addEventListener("pointerdown", (ev) => {
    if (canvas.setPointerCapture && ev && ev.pointerId != null) {
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch {
        /* happy-dom */
      }
    }
    move(ev);
  });
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("touchstart", move, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
}

function bindChartResize() {
  if (chartResizeBound || typeof window === "undefined") return;
  chartResizeBound = true;
  window.addEventListener("resize", () => {
    const canvas = document.getElementById("port-pnl-chart");
    if (canvas && canvas._series) drawPnlChart(canvas, canvas._series);
  });
}

function emptyHist(root, msg) {
  clear(root);
  root.appendChild(note(msg, "px-3 py-6 text-center text-sm text-mist-400"));
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

function renderPortHist(state) {
  bindPortHistOnce();
  const connected = !!(state && state.address);
  const data = (state && state.data) || {};
  const extras = (state && state.extras) || {};
  const empty = (rootId, noun) => {
    const root = document.getElementById(rootId);
    if (!root) return;
    emptyHist(root, connected ? "No " + noun + "." : "Connect wallet to view " + noun + ".");
  };

  const balRoot = document.getElementById("port-balances");
  if (balRoot) {
    clear(balRoot);
    if (!connected) emptyHist(balRoot, "Connect wallet to view balances.");
    else {
      const rows = buildBalanceRows({
        perps: data.perps || {},
        spotBalances: (data.spot && data.spot.balances) || [],
        mids: data.mids || {},
        markets: state.markets || [],
        hideSmall: portHideSmall,
        abstraction: data.abstraction,
      });
      if (!rows.length) emptyHist(balRoot, "No balances.");
      else {
        balRoot.appendChild(
          histTable(
            ["Asset", "Total Balance", "Available Balance", "Value (USD)", "PNL %"],
            rows.map((r) =>
              h(
                "tr",
                null,
                h("td", null, r.label || r.coin),
                h("td", null, fmtQty(r.total)),
                h("td", null, fmtQty(r.available)),
                h("td", null, Number.isFinite(r.value) ? fmtUsd(r.value) : "--"),
                h("td", { class: r.pnlPct == null ? "" : pnlClass(r.pnlPct) }, formatPnlPct(r.pnlPct) === "—" ? "--" : formatPnlPct(r.pnlPct))
              )
            )
          )
        );
      }
    }
  }

  const posRoot = document.getElementById("port-positions");
  if (posRoot) {
    if (!connected) empty("port-positions", "positions");
    else {
      const rows = positionRows((data.perps && data.perps.assetPositions) || []);
      const mids = data.mids || {};
      if (!rows.length) emptyHist(posRoot, "No open perps.");
      else {
        clear(posRoot);
        posRoot.appendChild(buildPositionsTable(rows, mids));
      }
    }
  }

  const outRoot = document.getElementById("port-outcomes");
  if (outRoot) {
    if (!connected) empty("port-outcomes", "outcomes");
    else {
      const rows = outcomePositionsFromSpot((data.spot && data.spot.balances) || [], state.markets || []);
      if (!rows || !rows.length) emptyHist(outRoot, "No outcomes yet");
      else {
        clear(outRoot);
        outRoot.appendChild(
          histTable(
            ["Market", "Size", "Available Size", "Position Value", "Entry Price", "Mark Price", "PNL (ROE %)"],
            rows.map((r) => {
              const m = outcomePositionMetrics(r);
              const pnlTxt =
                m.pnlPct == null && !Number.isFinite(m.pnlUsd)
                  ? "--"
                  : (Number.isFinite(m.pnlUsd) ? fmtUsd(m.pnlUsd, { signed: true }) : "--") +
                    " (" +
                    formatPnlPct(m.pnlPct) +
                    ")";
              return h(
                "tr",
                null,
                h("td", null, r.title || r.coin || "--"),
                h("td", null, fmtQty(r.total)),
                h("td", null, fmtQty(r.available)),
                h("td", null, Number.isFinite(m.value) ? fmtUsd(m.value) : "--"),
                h("td", null, Number.isFinite(m.entryPx) ? fmtPx(m.entryPx) : "--"),
                h("td", null, r.markPx != null && Number.isFinite(Number(r.markPx)) ? fmtPx(r.markPx) : "--"),
                h("td", { class: Number.isFinite(m.pnlUsd) ? pnlClass(m.pnlUsd) : "" }, pnlTxt)
              );
            })
          )
        );
      }
    }
  }

  const ordRoot = document.getElementById("port-orders");
  if (ordRoot) {
    if (!connected) empty("port-orders", "open orders");
    else {
      const orders = data.openOrders || [];
      if (!orders.length) emptyHist(ordRoot, "No open orders.");
      else {
        clear(ordRoot);
        ordRoot.appendChild(
          histTable(
            ["Time", "Coin", "Direction", "Size", "Price", "Status", "Order ID"],
            orders.slice(0, 50).map((o) =>
              h(
                "tr",
                null,
                h("td", null, formatLocalTime(o.timestamp)),
                h("td", null, o.coin || "--"),
                h("td", { class: o.side === "B" ? "text-buy" : "text-sell" }, o.side === "B" ? "Buy" : "Sell"),
                h("td", null, fmtQty(o.origSz || o.sz)),
                h("td", null, fmtPx(o.limitPx)),
                h("td", null, "Open"),
                h("td", null, String(o.oid || ""))
              )
            )
          )
        );
      }
    }
  }

  const twapRoot = document.getElementById("port-twap");
  if (twapRoot) {
    if (!connected) empty("port-twap", "TWAPs");
    else {
      const hist = extras.twapHistory || [];
      if (!hist.length) emptyHist(twapRoot, "No TWAP orders.");
      else {
        clear(twapRoot);
        twapRoot.appendChild(
          histTable(
            ["Coin", "Side", "Size", "Minutes", "Status"],
            hist.slice(0, 50).map((t) => {
              const st = t.state || t;
              return h(
                "tr",
                null,
                h("td", null, st.coin || "--"),
                h("td", { class: st.side === "B" ? "text-buy" : "text-sell" }, st.side === "B" ? "Buy" : "Sell"),
                h("td", null, fmtQty(st.sz)),
                h("td", null, String(st.minutes || "")),
                h("td", null, st.status || "--")
              );
            })
          )
        );
      }
    }
  }

  const fundRoot = document.getElementById("port-funding");
  if (fundRoot) {
    if (!connected) empty("port-funding", "funding history");
    else {
      const rows = extras.fundingHistory || [];
      if (!rows.length) emptyHist(fundRoot, "No funding history.");
      else {
        clear(fundRoot);
        fundRoot.appendChild(
          histTable(
            ["Time", "Coin", "Size", "Position", "Payment", "Rate"],
            rows.slice(0, 50).map((f) => {
              const d = f.delta || {};
              return h(
                "tr",
                null,
                h("td", null, formatLocalTime(f.time)),
                h("td", null, d.coin || "--"),
                h("td", null, fmtQty(d.szi)),
                h("td", null, num(d.szi) >= 0 ? "Long" : "Short"),
                h("td", { class: pnlClass(d.usdc) }, fmtUsd(d.usdc, { signed: true })),
                h("td", null, formatFeePct(d.fundingRate))
              );
            })
          )
        );
      }
    }
  }

  const histRoot = document.getElementById("port-history");
  if (histRoot) {
    if (!connected) empty("port-history", "order history");
    else {
      const rows = extras.historicalOrders || [];
      if (!rows.length) emptyHist(histRoot, "No order history.");
      else {
        clear(histRoot);
        histRoot.appendChild(
          histTable(
            ["Time", "Coin", "Direction", "Size", "Price", "Status", "Order ID"],
            rows.slice(0, 50).map((row) => {
              const o = row.order || row;
              return h(
                "tr",
                null,
                h("td", null, formatLocalTime(o.timestamp)),
                h("td", null, o.coin || "--"),
                h("td", { class: o.side === "B" ? "text-buy" : "text-sell" }, o.side === "B" ? "Buy" : "Sell"),
                h("td", null, fmtQty(o.sz || o.origSz)),
                h("td", null, fmtPx(o.limitPx)),
                h("td", null, row.status || "--"),
                h("td", null, String(o.oid || ""))
              );
            })
          )
        );
      }
    }
  }
}

export function drawPnlChart(canvas, series) {
  if (!canvas) return;
  canvas._series = Array.isArray(series) ? series : [];
  const cssW = canvas.clientWidth || Number(canvas.getAttribute("width")) || 320;
  const cssH = canvas.clientHeight || Number(canvas.getAttribute("height")) || 160;
  const pts = canvas._series.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v));
  canvas._layout = pts.length ? portChartLayout(cssW, cssH, pts) : null;
  if (!canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
  const scrubT = canvas._scrubT;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  canvas._series = Array.isArray(series) ? series : [];
  canvas._layout = pts.length ? portChartLayout(cssW, cssH, pts) : null;
  canvas._scrubT = scrubT;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, cssW, cssH);
  if (!pts.length) return;

  const layout = canvas._layout;
  const { padL, padT, plotW, plotH, t0, tSpan } = layout;

  const ticks = axisTicks(pts, 4);
  const yMin = ticks.length ? ticks[0] : 0;
  const yMax = ticks.length ? ticks[ticks.length - 1] : 1;
  const ySpan = yMax - yMin || 1;

  const xOf = (t) => chartXOf(layout, t);
  const yOf = (v) => padT + ((yMax - v) / ySpan) * plotH;

  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  const xHairY = yMin <= 0 && yMax >= 0 ? yOf(0) : padT + plotH;
  ctx.moveTo(padL, xHairY);
  ctx.lineTo(padL + plotW, xHairY);
  ctx.stroke();

  ctx.fillStyle = "#94A3B8";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  (ticks.length ? ticks : []).forEach((tick) => {
    const y = yOf(tick);
    ctx.beginPath();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.moveTo(padL - 4, y);
    ctx.lineTo(padL, y);
    ctx.stroke();
    ctx.fillStyle = "#94A3B8";
    ctx.fillText(chartTickUsd(tick), padL - 8, y);
  });

  const nX = tSpan === 0 ? 1 : 4;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < nX; i++) {
    const tt = tSpan === 0 ? t0 : t0 + (tSpan * i) / (nX - 1);
    const x = xOf(tt);
    ctx.fillStyle = "#94A3B8";
    ctx.fillText(formatChartDate(tt, tSpan), x, padT + plotH + 6);
  }

  ctx.beginPath();
  ctx.strokeStyle = "#F8FAFC";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  let prevY = 0;
  pts.forEach((p, i) => {
    const x = xOf(p.t);
    const y = yOf(p.v);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, prevY);
      ctx.lineTo(x, y);
    }
    prevY = y;
  });
  ctx.stroke();

  const scrub = snapChartPointByT(pts, canvas._scrubT);
  if (!scrub) return;
  const sx = xOf(scrub.t);
  const sy = yOf(scrub.v);
  ctx.beginPath();
  ctx.strokeStyle = "#F8FAFC";
  ctx.lineWidth = 1;
  ctx.moveTo(sx + 0.5, padT);
  ctx.lineTo(sx + 0.5, padT + plotH);
  ctx.stroke();

  const tip = formatScrubberTip(scrub.t, scrub.v);
  if (!tip) return;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  const tw = Math.ceil(ctx.measureText(tip).width) + 16;
  const th = 24;
  let tx = sx + 8;
  let ty = sy - th / 2;
  if (tx + tw > cssW - 4) tx = sx - 8 - tw;
  if (tx < 4) tx = 4;
  if (ty < 4) ty = 4;
  if (ty + th > cssH - 4) ty = cssH - th - 4;
  ctx.fillStyle = "#080D1A";
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(tx + 0.5, ty + 0.5, tw, th);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#F8FAFC";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(tip, tx + 8, ty + th / 2);
}

export function renderDashboard(el, state) {
  const dash = document.getElementById("dashboard");
  if (dash) {
    dash._lastState = state;
    dash._lastEl = el;
  }
  bindPortHistOnce();
  bindChartResize();

  if (el && el.loading) el.loading.classList.toggle("hidden", !state.loading);
  if (el && el.errorBanner) {
    if (state.error) {
      el.errorBanner.textContent = state.error;
      el.errorBanner.classList.remove("hidden");
    } else {
      el.errorBanner.classList.add("hidden");
    }
  }
  if (el && el.dashContent) el.dashContent.classList.remove("hidden");

  const pasteWrap = document.getElementById("port-paste-wrap");
  if (pasteWrap) pasteWrap.classList.toggle("hidden", !!(state && state.address));

  const connected = !!(state && state.address);
  if (!connected) portAcct = "all";
  const data = (state && state.data) || {};
  const perps = data.perps || {};
  const spotBalances = (data.spot && data.spot.balances) || [];
  const mids = data.mids || {};
  const fees = data.userFees;
  const portfolio = parsePortfolio(data.portfolio);
  const perpsOnly = portAcct === "perps";
  const block = connected ? summaryBlock(portfolio, portPeriod, portAcct) : null;
  syncPortChrome();

  const vol14 = connected ? sum14DayVolume(fees && fees.dailyUserVlm) : null;
  const volEl = document.getElementById("port-14d-vol");
  if (volEl) volEl.textContent = money(vol14);

  const perpTaker = document.getElementById("port-fee-perp-taker");
  const perpMaker = document.getElementById("port-fee-perp-maker");
  const spotTaker = document.getElementById("port-fee-spot-taker");
  const spotMaker = document.getElementById("port-fee-spot-maker");
  if (perpTaker) perpTaker.textContent = feeTxt(connected, fees, fees && fees.userCrossRate);
  if (perpMaker) perpMaker.textContent = feeTxt(connected, fees, fees && fees.userAddRate);
  if (spotTaker) spotTaker.textContent = feeTxt(connected && !perpsOnly, fees, fees && fees.userSpotCrossRate);
  if (spotMaker) spotMaker.textContent = feeTxt(connected && !perpsOnly, fees, fees && fees.userSpotAddRate);
  const spotFeeRow = document.getElementById("port-fee-spot-row");
  if (spotFeeRow) spotFeeRow.classList.toggle("hidden", perpsOnly);

  const pnl = connected ? lastPnl(block) : null;
  const vol = connected ? periodVolume(block) : null;
  const perpEq = connected && data.perps ? perpsEquity(perps) : null;
  const spotEq = connected && data.spot && !perpsOnly ? spotEquityUsd(spotBalances, mids, state.markets) : null;
  const vaultEq = connected && !perpsOnly
    ? sumVaultEquity([].concat(data.userVaultEquities || [], data.leadingVaults || []))
    : null;
  const stake = connected && !perpsOnly ? stakingUsd(data.staking, mids.HYPE) : null;
  const upnl = connected ? upnlSum(perps) : null;
  const totalParts = perpsOnly
    ? [perpEq].filter((n) => n != null && Number.isFinite(n))
    : [perpEq, spotEq, vaultEq, stake].filter((n) => n != null && Number.isFinite(n));
  const totalEq = connected && totalParts.length ? totalParts.reduce((a, b) => a + b, 0) : null;

  const setRow = (id, text, cls) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = text;
    node.className = "port-acct-v" + (cls ? " " + cls : "");
  };
  setRow("port-pnl", moneySigned(pnl), pnl == null ? "" : pnlClass(pnl));
  setRow("port-vol", money(vol));
  setRow("port-total-eq", money(totalEq));
  setRow("port-spot-eq", money(spotEq));
  setRow("port-perp-eq", money(perpEq));
  setRow("port-upnl", moneySigned(upnl), upnl == null ? "" : pnlClass(upnl));
  setRow("port-vault-eq", money(vaultEq));
  setRow("port-earn", missingMoney());
  setRow("port-stake", perpsOnly ? missingMoney() : stakeText(connected, data.staking, mids.HYPE));
  const spotEqRow = document.getElementById("port-spot-eq-row");
  if (spotEqRow) spotEqRow.classList.toggle("hidden", perpsOnly);

  if (el && el.dashUpdated) {
    const time = perps.time;
    el.dashUpdated.textContent = connected && time ? "Venue snapshot · " + formatLocalTime(time) : "";
  }

  const canvas = document.getElementById("port-pnl-chart");
  const series = connected ? chartSeries(portfolio, portPeriod, portChart, portAcct) : [];
  if (canvas && canvas._scrubT != null && series.length) {
    const keep = snapChartPointByT(series, canvas._scrubT);
    canvas._scrubT = keep ? keep.t : null;
  } else if (canvas && !series.length) {
    canvas._scrubT = null;
  }
  bindChartPointer(canvas);
  drawPnlChart(canvas, series);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => drawPnlChart(canvas, series));
  }

  renderPortHist(state);
}
