/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { mountTvChart, TV_SCRIPT } from "./tv-chart.js";

describe("TradingView embed", () => {
  it("loads the official Advanced Chart script and JSON via textContent", () => {
    const host = document.createElement("div");
    mountTvChart(host, { coin: "BTC", interval: "15m" });
    const script = host.querySelector("script");
    expect(script).toBeTruthy();
    expect(script.getAttribute("src")).toBe(TV_SCRIPT);
    expect(TV_SCRIPT).toBe("https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js");
    expect(script.textContent).toContain("HYPERLIQUID:BTCUSDC.P");
    expect(script.textContent).toContain('"interval":"15"');
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
