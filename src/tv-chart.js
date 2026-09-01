import { clear } from "./dom.js";
import { tvInterval, tvSymbol } from "./ticket-math.js";
import { mountHlChart } from "./hl-chart.js";

/** Official TradingView Advanced Chart iframe widget. Not user-configurable. */
export const TV_SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
export const TV_SUPPORT_HOST = "https://www.tradingview.com";

/** Same navy as the chart pane (`--bg-surface`). Toolbars must match this, not black. */
export const TV_CHROME = "#0F172A";

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
    support_host: TV_SUPPORT_HOST,
  };
}

/**
 * The public embed script allowlists `overrides` / `backgroundColor` but strips
 * `toolbar_bg`. Re-apply it on the iframe hash so the left drawing bar and top
 * widget bar use the same navy as the pane (not a host overlay).
 */
export function stampTvChrome(iframe) {
  if (!iframe || typeof iframe.getAttribute !== "function") return;
  const raw = iframe.getAttribute("src") || "";
  if (!raw || !/tradingview/i.test(raw)) return;
  let url;
  try {
    url = new URL(raw, "https://www.tradingview-widget.com/");
  } catch {
    return;
  }
  const encoded = (url.hash || "").replace(/^#/, "");
  if (!encoded) return;
  let cfg;
  try {
    cfg = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return;
  }
  if (!cfg || typeof cfg !== "object") return;
  const overrides = { ...(cfg.overrides && typeof cfg.overrides === "object" ? cfg.overrides : {}), ...TV_OVERRIDES };
  if (
    cfg.toolbar_bg === TV_CHROME &&
    cfg.backgroundColor === TV_CHROME &&
    overrides["paneProperties.background"] === TV_CHROME &&
    overrides["paneProperties.backgroundType"] === "solid"
  ) {
    return;
  }
  cfg.backgroundColor = TV_CHROME;
  cfg.toolbar_bg = TV_CHROME;
  cfg.overrides = overrides;
  cfg.loading_screen = {
    ...(cfg.loading_screen && typeof cfg.loading_screen === "object" ? cfg.loading_screen : {}),
    backgroundColor: TV_CHROME,
  };
  url.hash = encodeURIComponent(JSON.stringify(cfg));
  iframe.setAttribute("src", url.toString());
}

function watchWidgetIframe(root) {
  const apply = (node) => {
    if (!node) return;
    if (node.tagName === "IFRAME") stampTvChrome(node);
    else if (node.querySelectorAll) node.querySelectorAll("iframe").forEach(stampTvChrome);
  };
  apply(root);
  if (typeof MutationObserver === "undefined") return;
  const mo = new MutationObserver((recs) => {
    recs.forEach((r) => {
      r.addedNodes.forEach(apply);
      if (r.type === "attributes" && r.target && r.target.tagName === "IFRAME") stampTvChrome(r.target);
    });
  });
  mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
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
  const script = document.createElement("script");
  script.src = TV_SCRIPT;
  script.async = true;
  script.type = "text/javascript";
  script.textContent = JSON.stringify(tvWidgetConfig({ symbol, interval }));
  wrap.appendChild(script);
  watchWidgetIframe(wrap);
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
