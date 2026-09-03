import { clear } from "./dom.js";
import { tvInterval, tvSymbol } from "./ticket-math.js";
import { mountHlChart } from "./hl-chart.js";

/**
 * Official TradingView Advanced Chart iframe widget. Not user-configurable.
 * Charting Library is proprietary (Hyperliquid hosts a licensed copy) and is
 * not vendored here. HIP-4 candles come from Hyperliquid `candleSnapshot`.
 */
export const TV_SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
export const TV_WIDGET_PAGE = "https://www.tradingview-widget.com/embed-widget/advanced-chart/";
/** Same-origin snapshot of TV_WIDGET_PAGE. Path must match TV's onWidget() embed regex. */
export const TV_EMBED_PAGE = "/embed-widget/advanced-chart/";
export const TV_SUPPORT_HOST = "https://www.tradingview.com";

/** HyperTools navy. Used only by the unused same-origin snapshot CSS, never the live widget. */
export const TV_CHROME = "#0F172A";
export const TV_ACCENT = "#06B6D4";
export const TV_ICE = "#F8FAFC";
/** TradingView stock dark pane. Live iframe placeholder only — not a series override. */
export const TV_PANE = "#131722";
export const TV_CHROME_CSS_PATH = "/tv-chrome.css";
export const TV_CHROME_CSS_URL = TV_CHROME_CSS_PATH;

export function tvChromeCssUrl(origin) {
  const base =
    origin ||
    (typeof location !== "undefined" && location.origin && location.origin !== "null"
      ? location.origin
      : "");
  if (!base) return TV_CHROME_CSS_PATH;
  return String(base).replace(/\/$/, "") + TV_CHROME_CSS_PATH;
}

/**
 * Official TV chrome tokens plus frameless toolbar buttons.
 * Hosted at TV_CHROME_CSS_URL (`custom_css_url`) and inlined on the same-origin
 * snapshot. Painting every toolbar descendant navy left grey/navy tiles around
 * the selected interval and candle-type; those controls must be transparent.
 */
export const TV_CHROME_CSS = `
html[data-theme="dark"], [data-theme="dark"], html.theme-dark, html, body,
.theme-dark:root, :root {
  --color-header-bg: ${TV_CHROME} !important;
  --color-body-bg: ${TV_CHROME} !important;
  --color-pane-bg: ${TV_CHROME} !important;
  --color-chart-page-bg: ${TV_CHROME} !important;
  --tv-color-platform-background: ${TV_CHROME} !important;
  --tv-color-pane-background: ${TV_CHROME} !important;
  --tv-color-pane-background-secondary: ${TV_CHROME} !important;
  --tv-color-toolbar-button-background-hover: transparent !important;
  --tv-color-toolbar-button-background-secondary-hover: transparent !important;
  --tv-color-toolbar-button-background-expanded: transparent !important;
  --tv-color-toolbar-button-background-active: transparent !important;
  --tv-color-toolbar-button-background-active-hover: transparent !important;
  --tv-color-toolbar-toggle-button-background-active: transparent !important;
  --tv-color-toolbar-toggle-button-background-active-hover: transparent !important;
  --tv-color-toolbar-button-text: ${TV_ICE} !important;
  --tv-color-toolbar-button-text-hover: ${TV_ICE} !important;
  --tv-color-toolbar-button-text-active: ${TV_ACCENT} !important;
  --tv-color-toolbar-button-text-active-hover: ${TV_ACCENT} !important;
  --tv-color-item-active-text: ${TV_ACCENT} !important;
  --tv-color-toolbar-divider-background: rgba(51, 65, 85, 0.55) !important;
  background: ${TV_CHROME} !important;
  background-color: ${TV_CHROME} !important;
}
.chart-page,
.chart-container,
.layout__area--center,
.layout__area--top,
.layout__area--left,
[class^="toolbar-"],
[class*=" toolbar-"] {
  background: ${TV_CHROME} !important;
  background-color: ${TV_CHROME} !important;
  background-image: none !important;
  box-shadow: none !important;
  border-color: transparent !important;
}
.layout__area--top button,
.layout__area--left button,
.layout__area--top [class*="button"],
.layout__area--left [class*="button"],
.layout__area--top [class*="apply-common-tooltip"],
.layout__area--left [class*="apply-common-tooltip"],
.layout__area--top [class*="isInteractive"],
.layout__area--left [class*="isInteractive"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  border-color: transparent !important;
  box-shadow: none !important;
  outline: none !important;
  outline-width: 0 !important;
  color: ${TV_ICE} !important;
  fill: ${TV_ICE} !important;
}
.layout__area--top button::before,
.layout__area--top button::after,
.layout__area--left button::before,
.layout__area--left button::after,
.layout__area--top [class*="button"]::before,
.layout__area--top [class*="button"]::after,
.layout__area--left [class*="button"]::before,
.layout__area--left [class*="button"]::after,
.layout__area--top [class*="apply-common-tooltip"]::before,
.layout__area--top [class*="apply-common-tooltip"]::after,
.layout__area--left [class*="apply-common-tooltip"]::before,
.layout__area--left [class*="apply-common-tooltip"]::after {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  box-shadow: none !important;
  outline: none !important;
}
.layout__area--top [class*="isActive"],
.layout__area--left [class*="isActive"],
.layout__area--top [class*="isOpened"],
.layout__area--left [class*="isOpened"] {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: 0 !important;
  outline: none !important;
  outline-width: 0 !important;
  color: ${TV_ACCENT} !important;
  fill: ${TV_ACCENT} !important;
}
.layout__area--top [class*="isActive"] svg,
.layout__area--left [class*="isActive"] svg,
.layout__area--top [class*="isActive"] svg path,
.layout__area--left [class*="isActive"] svg path {
  fill: ${TV_ACCENT} !important;
  color: ${TV_ACCENT} !important;
  stroke: ${TV_ACCENT} !important;
}
.layout__area--top [class*="isSelected"],
.layout__area--left [class*="isSelected"],
.layout__area--top [class*="isChecked"],
.layout__area--left [class*="isChecked"],
.layout__area--top [aria-checked="true"],
.layout__area--left [aria-checked="true"],
.layout__area--top [aria-pressed="true"],
.layout__area--left [aria-pressed="true"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  border: 0 !important;
  outline: none !important;
  color: ${TV_ACCENT} !important;
  fill: ${TV_ACCENT} !important;
}
.layout__area--top [class*="isSelected"] svg,
.layout__area--left [class*="isSelected"] svg,
.layout__area--top [class*="isChecked"] svg,
.layout__area--left [class*="isChecked"] svg,
.layout__area--top [class*="isSelected"] svg path,
.layout__area--left [class*="isSelected"] svg path {
  fill: ${TV_ACCENT} !important;
  color: ${TV_ACCENT} !important;
  stroke: ${TV_ACCENT} !important;
}
[class*="isActive-"],
[class*="isSelected-"],
[class*="isChecked-"],
[class*="button-"][class*="isActive"],
[class*="button-"][class*="isSelected"],
[class*="isActive-"] *,
[class*="isSelected-"] *,
[class*="button-"][class*="isActive"] * {
  color: ${TV_ACCENT} !important;
  fill: ${TV_ACCENT} !important;
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border-color: transparent !important;
  outline: none !important;
}
[aria-checked="true"],
[aria-pressed="true"] {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: 0 !important;
  outline: none !important;
  color: ${TV_ACCENT} !important;
  fill: ${TV_ACCENT} !important;
}
[class*="isActive-"]::before,
[class*="isActive-"]::after,
[class*="isSelected-"]::before,
[class*="isSelected-"]::after,
[class*="isChecked-"]::before,
[class*="isChecked-"]::after,
[class*="button-"][class*="isActive"]::before,
[class*="button-"][class*="isActive"]::after,
[class*="button-"][class*="isSelected"]::before,
[class*="button-"][class*="isSelected"]::after,
[class*="isActive-"] > *,
[class*="isSelected-"] > *,
[class*="button-"][class*="isActive"] > * {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  border: 0 !important;
  outline: none !important;
}
`;

/**
 * Drop HyperTools navy/cyan plot, scale, and toolbar paints so TV's dark theme wins.
 * Price/time axes, last-price badge, and scale lines come from `theme: dark` only —
 * never HyperTools navy scale fills or cyan axis text.
 */
export function stripTvPlotPaint(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  delete cfg.backgroundColor;
  delete cfg.toolbar_bg;
  delete cfg.gridColor;
  delete cfg.overrides;
  delete cfg.studies_overrides;
  delete cfg.custom_css_url;
  delete cfg.loading_screen;
  cfg.colorTheme = "dark";
  cfg.theme = "dark";
  return cfg;
}

export function tvWidgetConfig({ symbol, interval }) {
  return {
    autosize: true,
    symbol,
    interval: tvInterval(interval),
    timezone: "Etc/UTC",
    theme: "dark",
    colorTheme: "dark",
    style: "1",
    locale: "en",
    hide_top_toolbar: false,
    hide_legend: false,
    hide_side_toolbar: false,
    allow_symbol_change: false,
    save_image: false,
    calendar: false,
    hide_volume: false,
    withdateranges: false,
    details: false,
    hotlist: false,
    enable_publishing: false,
    support_host: TV_SUPPORT_HOST,
  };
}

export const TV_PAINT_MS = 8000;

function teardownChartHost(container) {
  if (!container || !container.querySelector) return;
  const host = container.querySelector(".tradingview-widget-container, .hl-chart-host");
  if (host && typeof host._chartTeardown === "function") host._chartTeardown();
}

/**
 * Official widget only. Same-origin `/embed-widget/...` is an empty SPA shell
 * and must never be the chart iframe src (it spins forever).
 * `custom_css_url` is omitted: a relative path 404s on tradingview-widget.com.
 */
export function stampTvChrome(iframe) {
  if (!iframe || typeof iframe.getAttribute !== "function") return;
  const raw = iframe.getAttribute("src") || "";
  if (!raw || !/tradingview|embed-widget|tv-embed/i.test(raw)) return;
  const relative = raw.startsWith("/") || !/^https?:\/\//i.test(raw);
  let parsed;
  try {
    parsed = relative ? new URL(raw, "http://ht.invalid") : new URL(raw);
  } catch {
    return;
  }
  let cfg = {};
  const encoded = (parsed.hash || "").replace(/^#/, "");
  if (encoded) {
    try {
      cfg = JSON.parse(decodeURIComponent(encoded));
    } catch {
      cfg = {};
    }
  }
  if (!cfg || typeof cfg !== "object") cfg = {};
  stripTvPlotPaint(cfg);
  const dest = new URL(TV_WIDGET_PAGE);
  dest.hash = encodeURIComponent(JSON.stringify(cfg));
  iframe.setAttribute("src", dest.toString());
}

export function officialTvWidgetSrc(src) {
  return String(src || "").startsWith("https://www.tradingview-widget.com/embed-widget/advanced-chart");
}

/**
 * Perps/spot: iframe `load` on the official host counts as a paint.
 * Do not treat a same-origin snapshot load as success.
 */
export function scheduleTvFallback(iframe, onFail, ms = TV_PAINT_MS, opts) {
  let settled = false;
  let timer = 0;
  const trustLoad = !opts || opts.trustLoad !== false;
  const finish = (failed) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (failed && typeof onFail === "function") onFail();
  };
  if (iframe && typeof iframe.addEventListener === "function") {
    iframe.addEventListener("load", () => {
      const src = iframe.getAttribute && iframe.getAttribute("src");
      if (trustLoad && officialTvWidgetSrc(src)) finish(false);
    });
    iframe.addEventListener("error", () => finish(true));
  }
  timer = setTimeout(() => finish(true), ms);
  return () => finish(false);
}

export function mountTvChart(container, { coin, interval, kind, base, quote, hlCoin, onFallback } = {}) {
  if (!container) return;
  if (kind === "outcome") {
    mountHlChart(container, { coin: hlCoin || coin, interval });
    return;
  }
  teardownChartHost(container);
  clear(container);
  const symbol = tvSymbol(coin, kind, base, quote);
  if (!symbol) {
    const note = document.createElement("p");
    note.className = "tv-skip";
    note.textContent = "No TradingView symbol for this market.";
    container.appendChild(note);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "tradingview-widget-container";
  wrap.style.height = "100%";
  wrap.style.width = "100%";
  wrap.style.background = TV_PANE;
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  widget.style.height = "100%";
  widget.style.width = "100%";
  widget.style.background = TV_PANE;
  wrap.appendChild(widget);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "TradingView chart");
  iframe.setAttribute("allowtransparency", "true");
  iframe.setAttribute("scrolling", "no");
  iframe.style.cssText = "width:100%;height:100%;border:0;margin:0;display:block;background:" + TV_PANE;
  const cfg = tvWidgetConfig({ symbol, interval });
  iframe.setAttribute("src", TV_WIDGET_PAGE + "#" + encodeURIComponent(JSON.stringify(cfg)));
  stampTvChrome(iframe);
  widget.appendChild(iframe);
  container.appendChild(wrap);
  const fallbackCoin = hlCoin || coin;
  const cancel = scheduleTvFallback(
    iframe,
    () => {
      mountHlChart(container, { coin: fallbackCoin, interval });
      if (typeof onFallback === "function") onFallback();
    },
    TV_PAINT_MS
  );
  wrap._chartTeardown = cancel;
}

/** Perps/spot: official TV when a Hyperliquid symbol exists. Outcomes: HL candles only, never a TV iframe. */
export function mountChart(container, opts) {
  if (!container) return "skip";
  const o = opts || {};
  const hlCoin = o.hlCoin || o.coin;
  if (o.kind === "outcome") {
    mountHlChart(container, { coin: hlCoin, interval: o.interval });
    return "hl";
  }
  const tvCoin = o.tvCoin || o.coin;
  const symbol = tvSymbol(tvCoin, o.kind, o.base, o.quote);
  if (symbol) {
    mountTvChart(container, { ...o, coin: tvCoin, hlCoin });
    return "tv";
  }
  mountHlChart(container, { coin: hlCoin, interval: o.interval });
  return "hl";
}
