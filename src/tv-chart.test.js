/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mountTvChart, TV_SCRIPT } from "./tv-chart.js";

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
