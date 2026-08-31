/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mountChart, mountTvChart, TV_SCRIPT } from "./tv-chart.js";
import { drawCandles } from "./hl-chart.js";
import { candleSnapshotBody, candlesToBars, hlCandleInterval } from "./api.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("TradingView embed", () => {
  it("loads the official Advanced Chart script and JSON via textContent", () => {
    const host = document.createElement("div");
    mountTvChart(host, { coin: "BTC", interval: "15m" });
    const script = host.querySelector("script");
    expect(script).toBeTruthy();
    expect(script.getAttribute("src")).toBe(TV_SCRIPT);
    expect(TV_SCRIPT).toBe("https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js");
    expect(script.textContent).toContain("HYPERLIQUID:BTCUSDC.P");
    expect(script.textContent).toContain('"hide_top_toolbar":true');
    expect(script.textContent).toContain('"hide_side_toolbar":true');
    expect(script.textContent).toContain('"withdateranges":false');
    expect(script.textContent).toContain('"save_image":false');
    expect(host.innerHTML).not.toContain("<img");
  });

  it("skips TradingView for outcome markets instead of embedding a BTC chart", () => {
    const host = document.createElement("div");
    mountTvChart(host, { coin: "#12100", interval: "15m", kind: "outcome" });
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toMatch(/No TradingView symbol/);
    expect(host.innerHTML).not.toContain("BTCUSDC");
  });

  it("falls back to a Hyperliquid candle canvas for outcome coins", () => {
    const host = document.createElement("div");
    host.style.height = "200px";
    mountChart(host, { coin: "#12100", interval: "15m", kind: "outcome" });
    expect(host.querySelector("script")).toBeNull();
    expect(host.innerHTML).not.toContain("BTCUSDC");
    expect(host.innerHTML).not.toContain("HYPERLIQUID:BTC");
    expect(host.querySelector("canvas.hl-chart") || host.querySelector(".tv-skip")).toBeTruthy();
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
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (ctx) expect(() => drawCandles(ctx, bars, 320, 180)).not.toThrow();
  });
});

describe("chart chrome", () => {
  it("uses 1px hairlines and a flush TV iframe with no extra widget border", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    expect(css).toMatch(/\.trade-stats \{[\s\S]*?border-bottom: 1px solid var\(--line\)/);
    expect(css).toMatch(/\.trade-iv \{[\s\S]*?height: 22px/);
    expect(css).toMatch(/\.trade-iv \{[\s\S]*?border-bottom: 1px solid var\(--line\)/);
    expect(css).toMatch(/\.tv-host iframe \{[\s\S]*?border: 0 !important/);
    expect(css).toMatch(/\.trade-chart \{[^}]*padding: 0;/);
    expect(css).toMatch(/\.trade-chart \{[^}]*border-right: 1px solid var\(--line\)/);
  });
});

describe("type weight", () => {
  it("keeps trade chrome at 400–600 with no fake-bold", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(css).toMatch(/\.nav-word \{[\s\S]*?font-weight: 500/);
    expect(css).toMatch(/\.nav-word\[aria-current="page"\] \{[\s\S]*?font-weight: 600/);
    expect(css).toMatch(/#market-chip-pair \{[\s\S]*?font-size: 18px/);
    expect(css).toMatch(/#market-chip-pair \{[\s\S]*?font-weight: 600/);
    expect(css).toMatch(/#market-chip-icon\.coin-icon \{[\s\S]*?width: 22px/);
    expect(css).toMatch(/\.lev-badge \{[\s\S]*?font-size: 11px/);
    expect(css).toMatch(/\.stat-k \{[^}]*font-size: 10px/);
    expect(css).toMatch(/\.stat-v \{[^}]*font-size: 12px/);
    expect(css).toMatch(/\.iv-btn \{[\s\S]*?font-size: 11px/);
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
