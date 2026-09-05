/**
 * @vitest-environment happy-dom
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountChart } from "./tv-chart.js";
import {
  LWC_DOWN,
  LWC_PANE,
  LWC_UP,
  candlesToLwcBars,
  lwcCandleColors,
  lwcChartOptions,
  mountHlLightweightChart,
  setLwcChartFactory,
} from "./hl-lwc-chart.js";

beforeAll(() => {
  setLwcChartFactory(() => ({
    addSeries: () => ({ setData: () => {} }),
    applyOptions: () => {},
    timeScale: () => ({ fitContent: () => {} }),
    remove: () => {},
  }));
});
afterAll(() => setLwcChartFactory(null));

describe("candlesToLwcBars", () => {
  it("keeps unix-second OHLC and drops invalid or duplicate times", () => {
    expect(candlesToLwcBars(null)).toEqual([]);
    const rows = candlesToLwcBars([
      { time: 1_700_000_100, open: 0.4, high: 0.5, low: 0.3, close: 0.45 },
      { time: 1_700_000_000, open: 0.3, high: 0.4, low: 0.2, close: 0.35 },
      { time: 1_700_000_000, open: 9, high: 9, low: 9, close: 9 },
      { time: "x", open: 1, high: 1, low: 1, close: 1 },
      { time: 10, open: NaN, high: 1, low: 1, close: 1 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].time).toBe(1_700_000_000);
    expect(rows[1].close).toBe(0.45);
  });
});

describe("lwc theme", () => {
  it("uses cyan/coral candles and an interactive dark pane", () => {
    const colors = lwcCandleColors();
    expect(colors.upColor).toBe(LWC_UP);
    expect(colors.downColor).toBe(LWC_DOWN);
    expect(colors.upColor).toBe("#06B6D4");
    expect(colors.downColor).toBe("#F43F5E");
    const opts = lwcChartOptions(640, 320);
    expect(opts.layout.background.color).toBe(LWC_PANE);
    expect(opts.handleScroll.mouseWheel).toBe(true);
    expect(opts.handleScroll.pressedMouseMove).toBe(true);
    expect(opts.handleScale.mouseWheel).toBe(true);
    expect(opts.handleScale.pinch).toBe(true);
    expect(opts.rightPriceScale.visible).toBe(true);
    expect(opts.timeScale.visible).toBe(true);
    expect(opts.crosshair).toBeTruthy();
  });
});

describe("mountHlLightweightChart", () => {
  it("creates an lwc host, wires resize teardown, and never embeds a TV iframe", () => {
    const applied = [];
    const removed = [];
    const host = document.createElement("div");
    host.style.width = "400px";
    host.style.height = "240px";
    document.body.appendChild(host);
    const stub = {
      addSeries: () => ({ setData: () => {} }),
      applyOptions: (o) => applied.push(o),
      timeScale: () => ({ fitContent: () => {} }),
      remove: () => removed.push(1),
    };
    mountHlLightweightChart(host, {
      coin: "#14570",
      interval: "15m",
      createChartFn: () => stub,
    });
    const wrap = host.querySelector(".hl-lwc-host");
    expect(wrap).toBeTruthy();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.innerHTML).not.toContain("tradingview-widget.com");
    expect(typeof wrap._chartTeardown).toBe("function");
    wrap._chartTeardown();
    expect(removed).toEqual([1]);
    document.body.removeChild(host);
  });

  it("shows the empty-market skip note when no coin is set", () => {
    const host = document.createElement("div");
    mountHlLightweightChart(host, { coin: "", interval: "15m" });
    expect(host.querySelector(".tv-skip").textContent).toMatch(/Select a market/);
  });
});

describe("mountChart outcome mode", () => {
  it("returns lwc for HIP-4 and leaves perps on the official widget path", () => {
    const out = document.createElement("div");
    expect(mountChart(out, { coin: "#12100", interval: "15m", kind: "outcome" })).toBe("lwc");
    expect(out.querySelector("iframe")).toBeNull();
    const lwc = out.querySelector(".hl-lwc-host");
    if (lwc && lwc._chartTeardown) lwc._chartTeardown();
    const perp = document.createElement("div");
    expect(mountChart(perp, { coin: "BTC", interval: "15m", kind: "perp" })).toBe("tv");
    expect(perp.querySelector("iframe")).toBeTruthy();
    expect(perp.querySelector("iframe").getAttribute("src")).toContain("tradingview-widget.com");
  });
});
