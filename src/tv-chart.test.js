/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setLwcChartFactory } from "./hl-lwc-chart.js";
import {
  mountChart,
  mountTvChart,
  officialTvWidgetSrc,
  scheduleTvFallback,
  stampTvChrome,
  stripTvPlotPaint,
  tvWidgetConfig,
  TV_CHROME,
  TV_CHROME_CSS,
  TV_EMBED_PAGE,
  TV_PAINT_MS,
  TV_PANE,
  TV_SCRIPT,
  TV_WIDGET_PAGE,
} from "./tv-chart.js";
import { drawCandles } from "./hl-chart.js";
import { candleSnapshotBody, candlesToBars, hlCandleInterval, prevDayFromDailyBars } from "./api.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeAll(() => {
  setLwcChartFactory(() => ({
    addSeries: () => ({ setData: () => {} }),
    applyOptions: () => {},
    timeScale: () => ({ fitContent: () => {} }),
    remove: () => {},
  }));
});
afterAll(() => setLwcChartFactory(null));

describe("TradingView embed", () => {
  it("loads the official Advanced Chart iframe, not a same-origin snapshot", () => {
    const host = document.createElement("div");
    mountTvChart(host, { coin: "BTC", interval: "15m" });
    const iframe = host.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(TV_SCRIPT).toBe("https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js");
    expect(TV_WIDGET_PAGE).toBe("https://www.tradingview-widget.com/embed-widget/advanced-chart/");
    expect(TV_EMBED_PAGE).toBe("/embed-widget/advanced-chart/");
    const src = iframe.getAttribute("src");
    expect(officialTvWidgetSrc(src)).toBe(true);
    expect(src.startsWith("https://www.tradingview-widget.com/embed-widget/advanced-chart/")).toBe(true);
    expect(src.startsWith("/embed-widget/")).toBe(false);
    const parsed = new URL(src);
    expect(parsed.origin).toBe("https://www.tradingview-widget.com");
    expect(parsed.searchParams.get("overrides")).toBeNull();
    const hash = decodeURIComponent(parsed.hash.slice(1));
    expect(hash).toContain("HYPERLIQUID:BTCUSDC.P");
    expect(hash).toContain('"hide_top_toolbar":false');
    expect(hash).toContain('"hide_legend":false');
    expect(hash).toContain('"hide_side_toolbar":false');
    expect(hash).toContain('"allow_symbol_change":false');
    expect(hash).toContain('"hide_volume":false');
    expect(hash).not.toContain("custom_css_url");
    expect(hash).not.toContain("/tv-chrome.css");
    expect(hash).toContain('"colorTheme":"dark"');
    expect(hash).toContain('"theme":"dark"');
    expect(hash).not.toContain("toolbar_bg");
    expect(hash).not.toContain("backgroundColor");
    expect(hash).not.toContain("paneProperties");
    expect(hash).not.toContain("scalesProperties");
    expect(hash).not.toContain("#0F172A");
    expect(hash).not.toContain("#06B6D4");
    expect(hash).not.toContain("gridColor");
    expect(hash).not.toContain('"studies"');
    expect(hash).toContain('"withdateranges":false');
    expect(hash).toContain('"save_image":false');
    expect(TV_PANE).toBe("#131722");
    expect(iframe.getAttribute("style")).toContain("#131722");
    expect(iframe.getAttribute("style")).not.toContain("#0F172A");
    expect(TV_CHROME_CSS).toContain(".layout__area--top");
    expect(TV_CHROME_CSS).toContain(".layout__area--left");
    expect(TV_CHROME_CSS).toContain("--tv-color-pane-background");
    expect(TV_CHROME_CSS).toContain("--color-header-bg");
    expect(TV_CHROME_CSS).toContain("--tv-color-toolbar-button-background-active: transparent");
    expect(TV_CHROME_CSS).toContain("--tv-color-toolbar-button-text-active: #06B6D4");
    expect(TV_CHROME_CSS).toContain("--tv-color-toolbar-button-text: #F8FAFC");
    expect(TV_CHROME_CSS).toContain('[class*="isActive-"]');
    expect(TV_CHROME_CSS).toContain('[class*="isSelected"]');
    expect(TV_CHROME_CSS).toContain("outline: none");
    expect(TV_CHROME_CSS).toContain("box-shadow: none");
    expect(TV_CHROME_CSS).not.toContain(".layout__area--top *");
    expect(TV_CHROME_CSS).not.toContain(".layout__area--left *");
    expect(host.innerHTML).not.toContain("<img");
    const snap = readFileSync(join(root, "public/embed-widget/advanced-chart/index.html"), "utf8");
    expect(snap).toContain('id="ht-tv-chrome"');
    expect(snap).toContain('id="ht-tv-chrome-file"');
    expect(snap).toContain("/tv-chrome.css");
    expect(snap).toContain("#0F172A");
    expect(snap).toContain(".layout__area--left");
    expect(snap).toContain("--tv-color-toolbar-button-background-active: transparent");
    expect(snap).toContain("TradingView Chart Widget");
    expect(snap).not.toContain("Paste an address");
    expect(snap).not.toContain('id="dashboard"');
    expect(snap).not.toMatch(/\snonce="/);
    expect(snap).toContain('id="ht-tv-flatten"');
    expect(snap).toContain("/tv-flatten.js");
    const flatten = readFileSync(join(root, "public/tv-flatten.js"), "utf8");
    expect(flatten).toContain("ht-tv-chrome-late");
    expect(flatten).toContain("shadowRoot");
    expect(flatten).toContain("isActive");
    expect(flatten).toContain("isSelected");
    expect(flatten).toContain("flattenToolbarTiles");
    expect(flatten).toContain("layout__area--top");
    expect(flatten).toContain("MutationObserver");
    expect(flatten).toContain("ht-tv-chrome");
    expect(flatten).toContain("location.origin");
    const hosted = readFileSync(join(root, "public/tv-chrome.css"), "utf8");
    expect(hosted).toBe(TV_CHROME_CSS);
  });

  it("skips TradingView for outcome hash ids instead of embedding a BTC chart", () => {
    const host = document.createElement("div");
    mountTvChart(host, { coin: "#12100", interval: "15m", kind: "outcome" });
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.innerHTML).not.toContain("BTCUSDC");
    expect(host.innerHTML).not.toContain("tradingview-widget.com");
    expect(host.querySelector(".hl-lwc-host") || host.querySelector(".hl-chart-host") || host.querySelector(".tv-skip")).toBeTruthy();
    host.querySelector(".hl-lwc-host")?._chartTeardown?.();
  });

  it("never mounts the official widget for HIP-4 outcome markets", () => {
    const host = document.createElement("div");
    mountTvChart(host, {
      coin: "out:pons-touches-1-by-sep-7-at-600-am-utc-yes",
      hlCoin: "#12880",
      interval: "5m",
      kind: "outcome",
    });
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.innerHTML).not.toContain("tradingview-widget.com");
    expect(host.innerHTML).not.toContain("HYPERLIQUID:out:");
    expect(host.innerHTML).not.toContain("BTCUSDC");
    expect(host.innerHTML).not.toContain("HYPERLIQUID:BTC");
    host.querySelector(".hl-lwc-host")?._chartTeardown?.();
  });

  it("mounts Lightweight Charts for outcome coins, never a TV iframe", () => {
    const host = document.createElement("div");
    host.style.height = "200px";
    const kind = mountChart(host, { coin: "#12100", interval: "15m", kind: "outcome" });
    expect(kind).toBe("lwc");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.innerHTML).not.toContain("BTCUSDC");
    expect(host.innerHTML).not.toContain("HYPERLIQUID:BTC");
    expect(host.innerHTML).not.toContain("tradingview-widget.com");
    expect(host.querySelector(".hl-lwc-host") || host.querySelector(".tv-skip")).toBeTruthy();
    const wrap = host.querySelector(".hl-lwc-host");
    if (wrap && wrap._chartTeardown) wrap._chartTeardown();
  });

  it("charts the outcome hash coin on Lightweight Charts, never a TV iframe or BTC", () => {
    const host = document.createElement("div");
    const kind = mountChart(host, {
      coin: "#12880",
      tvCoin: "out:pons-touches-1-by-sep-7-at-600-am-utc-yes",
      hlCoin: "#12880",
      interval: "5m",
      kind: "outcome",
    });
    expect(kind).toBe("lwc");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.innerHTML).not.toContain("tradingview-widget.com");
    expect(host.innerHTML).not.toContain("HYPERLIQUID:out:");
    expect(host.innerHTML).not.toContain("BTCUSDC");
    expect(host.querySelector(".hl-lwc-host") || host.querySelector(".hl-chart-host") || host.querySelector(".tv-skip")).toBeTruthy();
    host.querySelector(".hl-lwc-host")?._chartTeardown?.();
  });

  it("strips HyperTools pane/scale/toolbar paints so stock TV dark colors apply", () => {
    const iframe = document.createElement("iframe");
    const cfg = {
      symbol: "HYPERLIQUID:BTCUSDC.P",
      theme: "dark",
      backgroundColor: "#0F172A",
      toolbar_bg: "#0F172A",
      gridColor: "rgba(51, 65, 85, 0.45)",
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      overrides: {
        "paneProperties.background": "#0F172A",
        "scalesProperties.backgroundColor": "#0F172A",
        "mainSeriesProperties.candleStyle.upColor": "#06B6D4",
      },
    };
    iframe.setAttribute(
      "src",
      "https://www.tradingview-widget.com/embed-widget/advanced-chart/#" + encodeURIComponent(JSON.stringify(cfg))
    );
    stampTvChrome(iframe);
    const src = iframe.getAttribute("src");
    const parsed = new URL(src);
    const hash = decodeURIComponent(parsed.hash.slice(1));
    expect(src.startsWith("https://www.tradingview-widget.com/embed-widget/advanced-chart/")).toBe(true);
    expect(hash).not.toContain("custom_css_url");
    expect(hash).not.toContain("toolbar_bg");
    expect(hash).not.toContain("backgroundColor");
    expect(hash).not.toContain("paneProperties");
    expect(hash).not.toContain("scalesProperties");
    expect(hash).not.toContain("candleStyle");
    expect(hash).not.toContain("#0F172A");
    expect(hash).not.toContain("#06B6D4");
    expect(hash).toContain('"colorTheme":"dark"');
    expect(hash).toContain('"theme":"dark"');
    expect(hash).toContain('"hide_top_toolbar":false');
    expect(hash).toContain('"hide_side_toolbar":false');
    expect(parsed.searchParams.get("overrides")).toBeNull();
    expect(TV_CHROME).toBe("#0F172A");
    const stripped = stripTvPlotPaint({
      backgroundColor: "#0F172A",
      studies_overrides: { "volume.volume.color.0": "#06B6D4" },
      toolbar_bg: "#0F172A",
      overrides: { "scalesProperties.bgColor": "#0F172A" },
      theme: "light",
    });
    expect(stripped.backgroundColor).toBeUndefined();
    expect(stripped.overrides).toBeUndefined();
    expect(stripped.studies_overrides).toBeUndefined();
    expect(stripped.colorTheme).toBe("dark");
    expect(stripped.theme).toBe("dark");
  });

  it("leaves price and time scales on stock TV dark, not HyperTools navy or cyan", () => {
    const cfg = tvWidgetConfig({ symbol: "HYPERLIQUID:BTCUSDC.P", interval: "15m" });
    expect(cfg.theme).toBe("dark");
    expect(cfg.colorTheme).toBe("dark");
    expect(cfg.overrides).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toMatch(/scalesProperties/);
    expect(JSON.stringify(cfg)).not.toContain("#0F172A");
    expect(JSON.stringify(cfg)).not.toContain("#06B6D4");
    const stripped = stripTvPlotPaint({
      colorTheme: "dark",
      overrides: {
        "scalesProperties.backgroundColor": "#0F172A",
        "scalesProperties.bgColor": "#0F172A",
        "scalesProperties.textColor": "#06B6D4",
        "scalesProperties.lineColor": "#06B6D4",
      },
    });
    expect(stripped.overrides).toBeUndefined();
    expect(JSON.stringify(stripped)).not.toMatch(/scalesProperties/);
    expect(JSON.stringify(stripped)).not.toContain("#06B6D4");
    const host = document.createElement("div");
    mountTvChart(host, { coin: "BTC", interval: "15m" });
    const hash = decodeURIComponent(new URL(host.querySelector("iframe").getAttribute("src")).hash.slice(1));
    expect(hash).not.toContain("scalesProperties");
    expect(hash).not.toContain("#06B6D4");
    expect(hash).toContain('"theme":"dark"');
  });

  it("rewrites a same-origin embed-widget src to the official widget host", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "/embed-widget/advanced-chart/#" + encodeURIComponent(JSON.stringify({ symbol: "HYPERLIQUID:BTCUSDC.P", theme: "dark" })));
    stampTvChrome(iframe);
    const src = iframe.getAttribute("src");
    expect(src.startsWith("https://www.tradingview-widget.com/embed-widget/advanced-chart/")).toBe(true);
    expect(src.startsWith("/embed-widget/")).toBe(false);
    const parsed = new URL(src);
    expect(parsed.searchParams.get("overrides")).toBeNull();
    expect(decodeURIComponent(parsed.hash.slice(1))).not.toContain("toolbar_bg");
    expect(decodeURIComponent(parsed.hash.slice(1))).not.toContain("#0F172A");
    expect(decodeURIComponent(parsed.hash.slice(1))).not.toContain("custom_css_url");
  });

  it("falls back to HL candles if the official widget does not load in 8s", () => {
    vi.useFakeTimers();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", TV_WIDGET_PAGE + "#{}");
    let failed = false;
    scheduleTvFallback(iframe, () => {
      failed = true;
    }, TV_PAINT_MS);
    vi.advanceTimersByTime(TV_PAINT_MS - 1);
    expect(failed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(failed).toBe(true);
    vi.useRealTimers();
  });

  it("does not treat a same-origin snapshot load as a successful paint", () => {
    vi.useFakeTimers();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", TV_EMBED_PAGE);
    let failed = false;
    scheduleTvFallback(iframe, () => {
      failed = true;
    }, TV_PAINT_MS);
    iframe.dispatchEvent(new Event("load"));
    expect(failed).toBe(false);
    vi.advanceTimersByTime(TV_PAINT_MS);
    expect(failed).toBe(true);
    vi.useRealTimers();
  });

  it("cancels the 8s fallback when the official widget loads", () => {
    vi.useFakeTimers();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", TV_WIDGET_PAGE + "#{}");
    let failed = false;
    scheduleTvFallback(iframe, () => {
      failed = true;
    }, TV_PAINT_MS);
    iframe.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(TV_PAINT_MS);
    expect(failed).toBe(false);
    vi.useRealTimers();
  });

  it("does not treat official-widget load as success for HIP-4 outcomes", () => {
    vi.useFakeTimers();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", TV_WIDGET_PAGE + "#{}");
    let failed = false;
    scheduleTvFallback(
      iframe,
      () => {
        failed = true;
      },
      TV_PAINT_MS,
      { trustLoad: false }
    );
    iframe.dispatchEvent(new Event("load"));
    expect(failed).toBe(false);
    vi.advanceTimersByTime(TV_PAINT_MS);
    expect(failed).toBe(true);
    vi.useRealTimers();
  });
});

describe("Hyperliquid candles", () => {
  it("requests candleSnapshot for the given coin, not a substitute ticker", () => {
    const body = candleSnapshotBody("#12100", "15m");
    expect(body.type).toBe("candleSnapshot");
    expect(body.req.coin).toBe("#12100");
    expect(body.req.interval).toBe("15m");
    expect(hlCandleInterval("1h")).toBe("1h");
    const bars = candlesToBars([
      { t: 1_700_000_000_000, o: "0.40", h: "0.45", l: "0.39", c: "0.42", v: "10" },
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(0.42);
    expect(prevDayFromDailyBars(bars)).toBe(0.4);
    expect(prevDayFromDailyBars([])).toBeNull();
    expect(
      prevDayFromDailyBars([
        { time: 1, open: 0.5, high: 0.6, low: 0.4, close: 0.46 },
        { time: 2, open: 0.46, high: 0.5, low: 0.3, close: 0.36 },
      ])
    ).toBe(0.46);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (ctx) expect(() => drawCandles(ctx, bars, 320, 180)).not.toThrow();
  });
});

describe("chart chrome", () => {
  it("uses 1px hairlines and a flush TV iframe with no extra widget border", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    expect(css).toMatch(/\.trade-stats \{[\s\S]*?border-bottom: 1px solid var\(--border-color\)/);
    expect(css).toMatch(/\.trade-chart \{[^}]*grid-row: 2;/);
    expect(css).toMatch(/grid-template-areas:[\s\S]*?"chart book ticket"/);
    expect(css).not.toContain(".trade-iv");
    expect(css).not.toContain(".iv-btn");
    expect(css).toMatch(/\.hl-iv \{[\s\S]*?background: var\(--bg-surface\)/);
    expect(css).toMatch(/\.hl-iv-btn \{[\s\S]*?color: var\(--text-muted\)/);
    expect(css).toMatch(/\.hl-iv-btn\[aria-pressed="true"\] \{[\s\S]*?color: var\(--accent-primary\)/);
    expect(css).toMatch(/\.tv-host iframe \{[\s\S]*?border: 0 !important/);
    expect(css).toMatch(/\.trade-chart \{[^}]*padding: 0;/);
    expect(css).toMatch(/\.trade-chart \{[^}]*background: var\(--bg-surface\)/);
    expect(css).toMatch(/\.trade-chart \{[^}]*border-right: 1px solid var\(--border-color\)/);
    expect(css).toMatch(/\.hl-chart-host,[\s\S]*?background: var\(--bg-surface\)/);
    expect(css).not.toContain("mix-blend-mode");
    expect(css).toMatch(/grid-template-rows: auto minmax\(0, 1fr\) minmax\(140px, 18vh\)/);
    expect(css).toMatch(/grid-template-columns: minmax\(0, 1fr\) 248px 420px/);
  });
});

describe("deep teal theme", () => {
  it("uses Deep Teal & Sapphire tokens, not grey or navy fills", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const tw = readFileSync(join(root, "tailwind.config.js"), "utf8");
    const tv = readFileSync(join(root, "src/tv-chart.js"), "utf8");
    const hl = readFileSync(join(root, "src/hl-chart.js"), "utf8");
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(css).toContain("--bg-main: #080D1A");
    expect(css).toContain("--bg-surface: #0F172A");
    expect(css).toContain("--bg-input: #1E293B");
    expect(css).toContain("--border-color: #334155");
    expect(css).toContain("--accent-primary: #06B6D4");
    expect(css).toContain("--accent-success: #10B981");
    expect(css).toContain("--accent-danger: #F43F5E");
    expect(css).toContain("--text-primary: #F8FAFC");
    expect(css).toContain("--text-muted: #94A3B8");
    expect(css).not.toContain("#242525");
    expect(css).not.toContain("#1A2B56");
    expect(css).not.toContain("#2a2b2b");
    expect(css).not.toContain("#363737");
    expect(css).not.toContain("#00c853");
    expect(css).not.toContain("#283860");
    expect(tw).toContain('950: "#080D1A"');
    expect(tw).toContain('chrome: "#334155"');
    expect(tw).not.toContain("#242525");
    expect(tw).not.toContain("#1A2B56");
    expect(tv).toContain('export const TV_CHROME = "#0F172A"');
    expect(tv).toContain('export const TV_PANE = "#131722"');
    expect(tv).not.toContain("backgroundColor: TV_CHROME");
    expect(tv).not.toContain("toolbar_bg: TV_CHROME");
    expect(tv).not.toContain("paneProperties.background");
    expect(tv).not.toMatch(/"scalesProperties\.backgroundColor":/);
    expect(tv).not.toMatch(/"scalesProperties\.bgColor":/);
    expect(tv).toContain("export const TV_CHROME_CSS_PATH = \"/tv-chrome.css\"");
    expect(tv).toContain("function tvChromeCssUrl");
    expect(tv).toContain("delete cfg.custom_css_url");
    expect(tv).not.toMatch(/custom_css_url:\s*tvChromeCssUrl/);
    expect(tv).toContain("TV_WIDGET_PAGE");
    expect(tv).not.toContain('backgroundColor: "#242525"');
    expect(tv).not.toContain('backgroundColor: "#1A2B56"');
    expect(hl).toContain('const BG = "#0F172A"');
    expect(hl).toContain('const UP = "#06B6D4"');
    expect(hl).toContain('const DOWN = "#F43F5E"');
    expect(hl).not.toContain("#242525");
    expect(hl).not.toContain("#1A2B56");
    expect(html).toContain('content="#080D1A"');
    expect(css).toMatch(/\.chk \{[\s\S]*?color: var\(--text-primary\)/);
    expect(css).toContain("--accent-primary: #06B6D4");
    expect(css).toContain("--border-color: #334155");
    expect(css).toContain("--bg-surface: #0F172A");
    expect(css).toContain("--text-primary: #F8FAFC");
    expect(css).toMatch(/\.chk-box \{[\s\S]*?border: 1px solid var\(--border-color\)/);
    expect(css).toMatch(/\.chk-box \{[\s\S]*?background: var\(--bg-surface\)/);
    expect(css).toMatch(/:checked \+ \.chk-box \{[\s\S]*?border-color: var\(--accent-primary\)/);
    expect(css).toMatch(/:checked \+ \.chk-box \{[\s\S]*?background: var\(--bg-surface\)/);
    expect(css).toMatch(/:checked \+ \.chk-box::after \{[\s\S]*?background: var\(--accent-primary\)/);
    expect(css).toMatch(/:checked \+ \.chk-box::after \{[\s\S]*?inset: 2px/);
    expect(css).not.toMatch(/chk-box::after[\s\S]*?rotate\(45deg\)/);
    expect(css).not.toMatch(/chk-box::after[\s\S]*?content:\s*["'][✓✔]["']/);
    const chkCss = css.slice(css.indexOf(".chk-box {"), css.indexOf("input[type=\"checkbox\"]"));
    expect(chkCss).not.toMatch(/#7dd3c0|#1A2B56|#00c853|#0891B2/i);
    expect(chkCss).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(css).toMatch(/\.btn-connect \{[\s\S]*?background: var\(--accent-primary\)/);
    expect(css).toMatch(/\.btn-connect \{[\s\S]*?color: var\(--bg-main\)/);
    expect(css).toMatch(/\.ticket-submit\.connect,[\s\S]*?background: var\(--accent-primary\)/);
    expect(css).toMatch(/\.ticket-submit\.connect,[\s\S]*?color: var\(--bg-main\)/);
    expect(css).toMatch(/\.ticket-submit\.buy \{[^}]*background: var\(--accent-primary\)/);
    expect(css).toMatch(/\.ticket-submit\.buy \{[^}]*color: var\(--bg-main\)/);
    expect(css).toMatch(/\.mp-tab\[aria-selected="true"\] \{[\s\S]*?color: var\(--accent-primary\)/);
    expect(css).toMatch(/\.mp-tab\[aria-selected="true"\] \{[\s\S]*?box-shadow: inset 0 -2px 0 var\(--accent-primary\)/);
    expect(css).toMatch(/\.nav-word\[aria-current="page"\] \{[\s\S]*?color: var\(--accent-primary\)/);
    expect(css).toMatch(/\.book-tab\[aria-selected="true"\] \{[\s\S]*?box-shadow: inset 0 -2px 0 var\(--accent-primary\)/);
    expect(css).toMatch(/\.hist-tab\[aria-selected="true"\] \{[\s\S]*?box-shadow: inset 0 -2px 0 var\(--accent-primary\)/);
    expect(css).toMatch(/\.ls-tab\.short\[aria-pressed="true"\] \{[\s\S]*?color: var\(--accent-danger\)/);
    expect(css).toMatch(/\.ticket-submit\.sell \{[^}]*background: var\(--accent-danger\)/);
    expect(css).toMatch(/\.market-chip\[aria-expanded="true"\][\s\S]*?color: var\(--text-primary\)/);
    expect(css).toMatch(/\.market-chip\[aria-expanded="true"\] #market-chip-pair[\s\S]*?color: var\(--text-primary\)/);
    expect(css).toMatch(/\.market-chip:focus-visible[\s\S]*?color: var\(--text-primary\)/);
    expect(css).toMatch(/#market-chip-pair[\s\S]*?color: var\(--text-primary\)/);
    expect(css).toMatch(/\.mp-row\.is-on \.mp-pair[\s\S]*?color: var\(--text-primary\)/);
    expect(css).not.toMatch(/\.market-chip[^{]*\{[^}]*color:\s*var\(--accent-primary\)/);
    expect(css).not.toMatch(/#market-chip-pair[^{]*\{[^}]*color:\s*var\(--accent-primary\)/);
    expect(css).not.toMatch(/\.mp-pair[^{]*\{[^}]*color:\s*var\(--accent-primary\)/);
    expect(css).toMatch(/\.market-chip\[aria-expanded="true"\] \.chip-chevron-down \{[\s\S]*?display: none/);
    expect(css).toMatch(/\.market-chip\[aria-expanded="true"\] \.chip-chevron-up \{[\s\S]*?display: inline/);
    expect(css).toMatch(/\.chip-chevron-up \{ display: none/);
    expect(html).toContain('class="chip-chevron-down"');
    expect(html).toContain('class="chip-chevron-up"');
    expect(html).toContain("M2.5 4.5 L6 8 L9.5 4.5");
    expect(html).toContain("M2.5 7.5 L6 4 L9.5 7.5");
    expect(css).toMatch(/\.mp-star\.on \{ color: var\(--accent-primary\)/);
    expect(css).toMatch(/\.lev-badge \{[\s\S]*?background: var\(--accent-primary\)/);
    expect(css).toMatch(/\.lev-badge \{[\s\S]*?color: var\(--bg-main\)/);
    expect(css).toMatch(/\.mp-chg\.up \{ color: var\(--accent-success\)/);
    expect(css).toMatch(/\.stat-v\.up \{ color: var\(--accent-success\)/);
    expect(css).toMatch(/\.stat-v\.down \{ color: var\(--accent-danger\)/);
    expect(css).toMatch(/\.stat-v\.flat \{ color: var\(--text-muted\)/);
    expect(css).toMatch(/\.mp-chg\.down \{ color: var\(--accent-danger\)/);
    expect(css).toMatch(/\.book-row\.bid \.px \{ color: var\(--accent-success\)/);
    expect(css).toMatch(/\.book-row\.bid \.depth \{ background: var\(--accent-success\)/);
    expect(css).toMatch(/\.book-row\.ask \.px \{ color: var\(--accent-danger\)/);
    expect(css).toMatch(/\.book-row\.ask \.depth \{ background: var\(--accent-danger\)/);
    expect(css).toMatch(/\.book-row \.sz \{[^}]*color: var\(--text-primary\)/);
    expect(css).toMatch(/\.trade-row \.px\.buy \{ color: var\(--accent-success\)/);
    expect(css).toMatch(/\.btn-ghost,[\s\S]*?border: 1px solid var\(--border-color\)/);
    expect(css).toMatch(/\.btn-ghost,[\s\S]*?background: transparent/);
    expect(html).toMatch(/id="btn-refresh"[^>]*class="btn-ghost"/);
    expect(html).toMatch(/id="btn-disconnect"[^>]*class="btn-ghost"/);
    expect(html).toMatch(/id="nav-address"[^>]*class="addr-chip"/);
    expect(html).not.toMatch(/id="btn-refresh"[^>]*border-chrome/);
    expect(html).not.toMatch(/id="btn-disconnect"[^>]*border-chrome/);
  });
});

describe("type weight", () => {
  it("keeps trade chrome at 400–600 with no fake-bold", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(css).toMatch(/\.nav-word \{[\s\S]*?font-weight: 500/);
    expect(css).toMatch(/\.nav-word\[aria-current="page"\] \{[\s\S]*?font-weight: 600/);
    expect(css).toMatch(/#market-chip-pair[\s\S]*?font-size: 18px/);
    expect(css).toMatch(/#market-chip-pair[\s\S]*?font-weight: 600/);
    expect(css).toMatch(/#market-chip-icon\.coin-icon \{[\s\S]*?width: 22px/);
    expect(css).toMatch(/\.lev-badge \{[\s\S]*?font-size: 11px/);
    expect(css).toMatch(/\.stat-k \{[^}]*font-size: 10px/);
    expect(css).toMatch(/\.stat-v \{[^}]*font-size: 12px/);
    expect(css).not.toContain(".iv-btn");
    expect(css).not.toMatch(/-webkit-text-stroke/);
    expect(css).not.toMatch(/font-weight:\s*(700|800|900)/);
    expect(css).toMatch(/\.stat-k \{[^}]*font-weight: 400/);
    expect(css).toMatch(/\.stat-v \{[^}]*font-weight: 500/);
    expect(css).toMatch(/\.ticket-label \{[^}]*font-weight: 400/);
    expect(css).toMatch(/\.book-cols \{[\s\S]*?font-weight: 400/);
    expect(css).toMatch(/\.book-row \{[\s\S]*?font-weight: 400/);
    expect(css).toMatch(/\.hist-tab \{[\s\S]*?font-weight: 400/);
    expect(css).toMatch(/\.ticket-submit \{[\s\S]*?font-weight: 600/);
    expect(html).not.toMatch(/font-(extrabold|black|bold)\b/);
  });
});

describe("HL interval row", () => {
  it("is in the chart chrome, hidden by default, and used only for mountHlChart markets", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const trade = readFileSync(join(root, "src/trade.js"), "utf8");
    expect(html).toContain('id="hl-iv"');
    expect(html).toContain('class="hl-iv hidden"');
    expect(html).toContain('data-hl-iv="1m"');
    expect(html).toContain('data-hl-iv="5m"');
    expect(html).toContain('data-hl-iv="15m"');
    expect(html).toContain('data-hl-iv="1h"');
    expect(html).toContain('data-hl-iv="4h"');
    expect(html).toContain('data-hl-iv="1d"');
    expect(html).not.toContain('class="trade-iv"');
    expect(html).not.toContain("data-interval");
    expect(trade).toContain('renderHlIntervalRow(kind === "hl" || kind === "lwc" || !!(m && m.kind === "outcome") || pageKind === "outcome")');
    expect(trade).toContain("onFallback: () => renderHlIntervalRow(true)");
    expect(trade).toContain("outcomeLegCoin");
    expect(trade).not.toContain("outcomeLegTvCoin");
    expect(trade).toContain('byId("hl-iv")');
    expect(trade).toContain("setChartInterval");
    expect(trade).not.toContain(".trade-iv");
  });
});
