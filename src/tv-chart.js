import { clear } from "./dom.js";
import { tvInterval, tvSymbol } from "./ticket-math.js";
import { mountHlChart } from "./hl-chart.js";

/** Official TradingView Advanced Chart iframe widget. Not user-configurable. */
export const TV_SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
export const TV_SUPPORT_HOST = "https://www.tradingview.com";

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
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  widget.style.height = "100%";
  widget.style.width = "100%";
  wrap.appendChild(widget);
  const script = document.createElement("script");
  script.src = TV_SCRIPT;
  script.async = true;
  script.type = "text/javascript";
  script.textContent = JSON.stringify({
    autosize: true,
    symbol,
    interval: tvInterval(interval),
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    backgroundColor: "#1A2B56",
    gridColor: "rgba(54, 55, 55, 0.35)",
    hide_top_toolbar: true,
    hide_legend: true,
    hide_side_toolbar: true,
    allow_symbol_change: false,
    save_image: false,
    calendar: false,
    hide_volume: false,
    withdateranges: false,
    details: false,
    hotlist: false,
    enable_publishing: false,
    support_host: TV_SUPPORT_HOST,
  });
  wrap.appendChild(script);
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
