/**
 * TradingView Lightweight Charts (Apache-2.0) for HIP-4 outcome candles.
 * Not Charting Library. Perps/spot stay on the official Advanced Chart iframe.
 */
import { createChart as createLwcChart, CandlestickSeries, ColorType, CrosshairMode } from "lightweight-charts";
import { loadCandles } from "./api.js";
import { clear } from "./dom.js";

let chartFactory = createLwcChart;

/** Test hook — production always uses TradingView `createChart`. */
export function setLwcChartFactory(fn) {
  chartFactory = typeof fn === "function" ? fn : createLwcChart;
}

export const LWC_PANE = "#131722";
export const LWC_UP = "#06B6D4";
export const LWC_DOWN = "#F43F5E";
export const LWC_AXIS = "#94A3B8";
export const LWC_GRID = "rgba(51, 65, 85, 0.45)";
export const LWC_BORDER = "#334155";

/** HL Info uses ms; `loadCandles` / `candlesToBars` already emit unix seconds. */
export function candleTimeSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

export function candlesToLwcBars(bars) {
  if (!Array.isArray(bars)) return [];
  const out = [];
  const seen = new Set();
  bars.forEach((b) => {
    if (!b) return;
    const time = candleTimeSec(b.time ?? b.t ?? b.T);
    const open = Number(b.open ?? b.o);
    const highRaw = Number(b.high ?? b.h);
    const lowRaw = Number(b.low ?? b.l);
    const close = Number(b.close ?? b.c);
    if (!Number.isInteger(time) || time <= 0) return;
    if (![open, highRaw, lowRaw, close].every(Number.isFinite)) return;
    const high = Math.max(open, highRaw, lowRaw, close);
    const low = Math.min(open, highRaw, lowRaw, close);
    if (seen.has(time)) return;
    seen.add(time);
    out.push({ time, open, high, low, close });
  });
  out.sort((a, c) => a.time - c.time);
  return out;
}

/** Load vs render vs empty — never label a `setData` throw as a fetch failure. */
export function candleFailureNote(err, kind) {
  if (kind === "empty") return "No candle history for this market.";
  if (kind === "render") return "Could not render candles.";
  const raw = err && err.message ? String(err.message) : "";
  const http = raw.match(/^HTTP (\d{3})\b/);
  if (http) return "Could not load Hyperliquid candles (HTTP " + http[1] + ").";
  if (/invalid candle coin/i.test(raw)) return "Could not load Hyperliquid candles (invalid coin).";
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Could not load Hyperliquid candles (network).";
  }
  return "Could not load Hyperliquid candles.";
}

export function lwcCandleColors() {
  return {
    upColor: LWC_UP,
    downColor: LWC_DOWN,
    borderUpColor: LWC_UP,
    borderDownColor: LWC_DOWN,
    wickUpColor: LWC_UP,
    wickDownColor: LWC_DOWN,
  };
}

export function lwcChartOptions(width, height) {
  const w = Math.max(1, Math.floor(Number(width) || 320));
  const h = Math.max(1, Math.floor(Number(height) || 240));
  return {
    width: w,
    height: h,
    layout: {
      background: { type: ColorType.Solid, color: LWC_PANE },
      textColor: LWC_AXIS,
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: 11,
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: LWC_GRID },
      horzLines: { color: LWC_GRID },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: {
      visible: true,
      borderColor: LWC_BORDER,
      scaleMargins: { top: 0.08, bottom: 0.1 },
    },
    timeScale: {
      visible: true,
      borderColor: LWC_BORDER,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      axisPressedMouseMove: true,
      axisDoubleClickReset: true,
      mouseWheel: true,
      pinch: true,
    },
  };
}

function skipNote(container, text) {
  const note = document.createElement("p");
  note.className = "tv-skip";
  note.textContent = text;
  clear(container);
  container.appendChild(note);
}

export function mountHlLightweightChart(container, { coin, interval, createChartFn, loadCandlesFn } = {}) {
  if (!container) return;
  const prev = container.querySelector(".hl-lwc-host, .hl-chart-host, .tradingview-widget-container");
  if (prev && typeof prev._chartTeardown === "function") prev._chartTeardown();
  clear(container);
  const c = String(coin || "");
  if (!c) {
    skipNote(container, "Select a market to load candles.");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "hl-lwc-host hl-chart-host";
  wrap.setAttribute("title", "Lightweight Charts by TradingView");
  wrap.style.background = LWC_PANE;
  wrap.style.width = "100%";
  wrap.style.height = "100%";
  container.appendChild(wrap);

  let chart = null;
  let series = null;
  let ro = null;
  let cancelled = false;
  const makeChart = typeof createChartFn === "function" ? createChartFn : chartFactory;

  function size() {
    const w = wrap.clientWidth || container.clientWidth || 320;
    const h = wrap.clientHeight || container.clientHeight || 240;
    return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
  }

  function applySize() {
    if (!chart || cancelled) return;
    const { w, h } = size();
    chart.applyOptions({ width: w, height: h });
  }

  try {
    const { w, h } = size();
    chart = makeChart(wrap, lwcChartOptions(w, h));
    if (chart && typeof chart.addSeries === "function") {
      series = chart.addSeries(CandlestickSeries, lwcCandleColors());
    }
  } catch {
    chart = null;
    series = null;
  }

  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => applySize());
    ro.observe(wrap);
  }

  wrap._chartTeardown = () => {
    cancelled = true;
    if (ro) ro.disconnect();
    ro = null;
    if (chart && typeof chart.remove === "function") {
      try {
        chart.remove();
      } catch {
        /* already detached */
      }
    }
    chart = null;
    series = null;
  };

  const load = typeof loadCandlesFn === "function" ? loadCandlesFn : loadCandles;
  load(c, interval)
    .then((rows) => {
      if (cancelled) return;
      let bars = [];
      try {
        bars = candlesToLwcBars(rows);
      } catch (err) {
        wrap._chartTeardown();
        skipNote(container, candleFailureNote(err, "render"));
        return;
      }
      if (!bars.length) {
        wrap._chartTeardown();
        skipNote(container, candleFailureNote(null, "empty"));
        return;
      }
      try {
        if (!series || typeof series.setData !== "function") {
          throw new Error("chart series missing");
        }
        series.setData(bars);
        if (chart && chart.timeScale && typeof chart.timeScale().fitContent === "function") {
          chart.timeScale().fitContent();
        }
      } catch (err) {
        if (wrap._chartTeardown) wrap._chartTeardown();
        skipNote(container, candleFailureNote(err, "render"));
      }
    })
    .catch((err) => {
      if (cancelled) return;
      if (wrap._chartTeardown) wrap._chartTeardown();
      skipNote(container, candleFailureNote(err, "load"));
    });
}
