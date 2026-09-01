import { clear } from "./dom.js";
import { tvInterval, tvSymbol } from "./ticket-math.js";
import { mountHlChart } from "./hl-chart.js";

/** Official TradingView Advanced Chart iframe widget. Not user-configurable. */
export const TV_SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
export const TV_WIDGET_PAGE = "https://www.tradingview-widget.com/embed-widget/advanced-chart/";
/** Same-origin snapshot of TV_WIDGET_PAGE. Path must match TV's onWidget() embed regex. */
export const TV_EMBED_PAGE = "/embed-widget/advanced-chart/";
export const TV_SUPPORT_HOST = "https://www.tradingview.com";

/** Same navy as the chart pane (`--bg-surface`). Toolbars must match this, not black. */
export const TV_CHROME = "#0F172A";
export const TV_ACCENT = "#06B6D4";
export const TV_ICE = "#F8FAFC";
export const TV_CHROME_CSS_URL = "/tv-chrome.css";

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
[class*="isActive-"],
[class*="button-"][class*="isActive"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  border: 0 !important;
  outline: none !important;
  color: ${TV_ACCENT} !important;
  fill: ${TV_ACCENT} !important;
}
[class*="isActive-"]::before,
[class*="isActive-"]::after,
[class*="button-"][class*="isActive"]::before,
[class*="button-"][class*="isActive"]::after,
[class*="isActive-"] > *,
[class*="button-"][class*="isActive"] > * {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  border: 0 !important;
}
`;

export const TV_OVERRIDES = {
  "paneProperties.background": TV_CHROME,
  "paneProperties.backgroundType": "solid",
  "paneProperties.backgroundGradientStartColor": TV_CHROME,
  "paneProperties.backgroundGradientEndColor": TV_CHROME,
  "scalesProperties.backgroundColor": TV_CHROME,
  "scalesProperties.bgColor": TV_CHROME,
};

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
    backgroundColor: TV_CHROME,
    toolbar_bg: TV_CHROME,
    gridColor: "rgba(51, 65, 85, 0.45)",
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
    loading_screen: { backgroundColor: TV_CHROME },
    overrides: { ...TV_OVERRIDES },
    custom_css_url: TV_CHROME_CSS_URL,
    support_host: TV_SUPPORT_HOST,
  };
}

function serializeTvSrc(url, relative) {
  if (relative) return url.pathname + url.search + url.hash;
  return url.toString();
}

/**
 * The public embed script allowlists `backgroundColor` but strips `toolbar_bg`.
 * Stamp toolbar_bg onto the iframe hash, and put overrides on the query string
 * (`__defaultsOverrides` reads querySettings.overrides, not the hash).
 */
export function stampTvChrome(iframe) {
  if (!iframe || typeof iframe.getAttribute !== "function") return;
  const raw = iframe.getAttribute("src") || "";
  if (!raw || !/tradingview|embed-widget|tv-embed/i.test(raw)) return;
  const relative = raw.startsWith("/") || !/^https?:\/\//i.test(raw);
  let url;
  try {
    url = relative ? new URL(raw, "http://ht.invalid") : new URL(raw);
  } catch {
    return;
  }
  let cfg = {};
  const encoded = (url.hash || "").replace(/^#/, "");
  if (encoded) {
    try {
      cfg = JSON.parse(decodeURIComponent(encoded));
    } catch {
      cfg = {};
    }
  }
  if (!cfg || typeof cfg !== "object") cfg = {};
  const overrides = { ...(cfg.overrides && typeof cfg.overrides === "object" ? cfg.overrides : {}), ...TV_OVERRIDES };
  cfg.backgroundColor = TV_CHROME;
  cfg.toolbar_bg = TV_CHROME;
  cfg.custom_css_url = TV_CHROME_CSS_URL;
  cfg.colorTheme = "dark";
  cfg.theme = cfg.theme || "dark";
  cfg.overrides = overrides;
  cfg.loading_screen = {
    ...(cfg.loading_screen && typeof cfg.loading_screen === "object" ? cfg.loading_screen : {}),
    backgroundColor: TV_CHROME,
  };
  const overrideStr = JSON.stringify(TV_OVERRIDES);
  const nextHash = encodeURIComponent(JSON.stringify(cfg));
  const sameHash = (url.hash || "").replace(/^#/, "") === nextHash;
  const sameQuery = url.searchParams.get("overrides") === overrideStr;
  if (sameHash && sameQuery) return;
  url.hash = nextHash;
  url.searchParams.set("overrides", overrideStr);
  iframe.setAttribute("src", serializeTvSrc(url, relative));
}

export function mountTvChart(container, { coin, interval, kind, base, quote }) {
  if (!container) return;
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
  wrap.style.background = TV_CHROME;
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  widget.style.height = "100%";
  widget.style.width = "100%";
  widget.style.background = TV_CHROME;
  wrap.appendChild(widget);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "TradingView chart");
  iframe.setAttribute("allowtransparency", "true");
  iframe.setAttribute("scrolling", "no");
  iframe.style.cssText = "width:100%;height:100%;border:0;margin:0;display:block;background:" + TV_CHROME;
  const cfg = tvWidgetConfig({ symbol, interval });
  iframe.setAttribute("src", TV_EMBED_PAGE + "#" + encodeURIComponent(JSON.stringify(cfg)));
  stampTvChrome(iframe);
  widget.appendChild(iframe);
  container.appendChild(wrap);
}

/** TV when a Hyperliquid symbol exists; otherwise live HL candles for that coin (never a fake BTC chart). */
export function mountChart(container, opts) {
  if (!container) return;
  const o = opts || {};
  const symbol = tvSymbol(o.coin, o.kind, o.base, o.quote);
  if (symbol) {
    mountTvChart(container, o);
    return;
  }
  mountHlChart(container, o);
}
