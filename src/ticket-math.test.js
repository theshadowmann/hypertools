import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILDER_ADDRESS, sealOrderPayload } from "./order-build.js";
import {
  buyingPower,
  DEFAULT_MAX_SLIPPAGE,
  fundingCountdown,
  nextFundingMs,
  sealScalePayload,
  sizeFromAvailablePct,
  tvInterval,
  tvSymbol,
} from "./ticket-math.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("TradingView Hyperliquid symbols", () => {
  it("maps perps to HYPERLIQUID:{COIN}USDC.P", () => {
    expect(tvSymbol("BTC")).toBe("HYPERLIQUID:BTCUSDC.P");
    expect(tvSymbol("eth")).toBe("HYPERLIQUID:ETHUSDC.P");
    expect(tvSymbol("kPEPE")).toBe("HYPERLIQUID:KPEPEUSDC.P");
    expect(tvSymbol("btc<script>")).toBe("HYPERLIQUID:BTCSCRIPTUSDC.P");
    expect(tvSymbol("")).toBe("HYPERLIQUID:BTCUSDC.P");
    expect(tvSymbol("PURR/USDC", "spot", "PURR", "USDC")).toBe("HYPERLIQUID:PURRUSDC");
    expect(tvSymbol("@1", "spot", "HFUN", "USDC")).toBe("HYPERLIQUID:HFUNUSDC");
    expect(tvSymbol("#12100", "outcome")).toBeNull();
  });

  it("maps intervals to TradingView resolutions", () => {
    expect(tvInterval("1m")).toBe("1");
    expect(tvInterval("15m")).toBe("15");
    expect(tvInterval("1h")).toBe("60");
    expect(tvInterval("1d")).toBe("D");
  });
});

describe("available-to-trade sizing", () => {
  it("sizes from buying power (withdrawable × leverage)", () => {
    expect(buyingPower(100, 20)).toBe(2000);
    expect(sizeFromAvailablePct(buyingPower(1000, 1), 100000, 50, 5)).toBe(0.005);
    expect(sizeFromAvailablePct(buyingPower(100, 20), 100000, 100, 5)).toBe(0.02);
    expect(sizeFromAvailablePct(buyingPower(100, 20), 100000, 25, 5)).toBe(0.005);
    expect(sizeFromAvailablePct(0, 100000, 50, 5)).toBe(0);
    expect(sizeFromAvailablePct(NaN, 100000, 50, 5)).toBe(0);
  });

  it("clamps percent to 0–100", () => {
    expect(sizeFromAvailablePct(1000, 1000, 200, 4)).toBe(1);
    expect(sizeFromAvailablePct(1000, 1000, -10, 4)).toBe(0);
  });
});

describe("ticket defaults", () => {
  it("defaults market max slippage to 8%", () => {
    expect(DEFAULT_MAX_SLIPPAGE).toBe(0.08);
  });

  it("counts down to the next hourly funding", () => {
    const t = Date.parse("2026-08-31T12:34:10Z");
    expect(nextFundingMs(t)).toBe(Date.parse("2026-08-31T13:00:00Z"));
    expect(fundingCountdown(t)).toBe("25:50");
  });
});

describe("scale builder seal", () => {
  it("last-writes the sealed builder on scale payloads", () => {
    const sealed = sealScalePayload({
      orders: [{ a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" } } }],
      grouping: "na",
      builder: { b: "0x0000000000000000000000000000000000000999", f: 1 },
    });
    expect(sealed.builder).toEqual({ b: BUILDER_ADDRESS, f: 10 });
    expect(sealOrderPayload(sealed).builder.f).toBe(10);
  });
});

describe("trade guards", () => {
  it("blocks paste-address mode", async () => {
    const { assertCanTrade } = await import("./order-build.js");
    expect(() => assertCanTrade("paste")).toThrow(/Connect a wallet/);
    expect(() => assertCanTrade("wallet")).not.toThrow();
  });
});

describe("ticket DOM", () => {
  it("does not show a GTC / IOC / ALO segmented bar on the perp ticket", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const start = html.indexOf('id="ticket-form"');
    const end = html.indexOf('id="trade-balances"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const ticket = html.slice(start, end);
    expect(ticket).not.toMatch(/data-tif/);
    expect(ticket).not.toMatch(/\bALO\b/i);
    const withoutOutcomeTif = ticket.replace(/id="outcome-tif-wrap"[\s\S]*?<\/div>/, "");
    expect(withoutOutcomeTif).not.toMatch(/\bGTC\b/i);
    expect(withoutOutcomeTif).not.toMatch(/\bIOC\b/i);
    expect(ticket).toContain('id="ticket-tif"');
    expect(ticket).toContain("Buy / Long");
    expect(ticket).toContain("Sell / Short");
    expect(ticket).toContain("ticket-pct");
    expect(ticket).toContain("ticket-slip");
    expect(ticket).toContain("ticket-scroll");
    expect(ticket).toContain("ticket-foot");
    expect(ticket).toContain("ticket-core");
    expect(ticket).toContain("ticket-core-tail");
    const priceAt = ticket.indexOf('id="ticket-price-wrap"');
    const scrollAt = ticket.indexOf('class="ticket-scroll"');
    const sizeAt = ticket.indexOf('id="ticket-amount-wrap"');
    expect(priceAt).toBeGreaterThan(-1);
    expect(priceAt).toBeLessThan(scrollAt);
    expect(sizeAt).toBeGreaterThan(-1);
    expect(sizeAt).toBeLessThan(scrollAt);
    expect(ticket.indexOf('id="ticket-scale-wrap"')).toBeGreaterThan(scrollAt);
    expect(ticket).toContain('id="sum-liq-row"');
    expect(ticket).toContain('id="sum-margin-row"');
    expect(ticket).toContain("chk-box");
    expect(html).toContain('id="market-chip-icon"');
    expect(html).toContain("Hide Small Balances");
    expect(html).toContain('id="trade-balances"');
  });

  it("uses word nav Trade / Portfolio / Outcome, not a pill slider", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toContain('id="nav-trade"');
    expect(html).toContain('id="nav-portfolio"');
    expect(html).toContain('id="nav-outcome"');
    expect(html).toMatch(/id="nav-portfolio"[^>]*>Portfolio<\/a>\s*<a href="\/outcome" id="nav-outcome"/);
    expect(html).toContain(">Outcome<");
    expect(html).not.toMatch(/<select[^>]*id="market-select"/);
    expect(html).toContain('id="market-chip"');
    expect(html).toContain('id="market-picker"');
    expect(html).toContain("Favorites");
    expect(html).toContain('class="trade-iv"');
    expect(html).toContain('data-interval="15m"');
    expect(html).toContain('data-mp-tab="outcome"');
    expect(html).toContain("8h Funding");
    expect(html).toContain('id="outcome-legs"');
    expect(html).toContain('id="leg-yes"');
    expect(html).toContain('id="ticket-tif"');
    expect(html).toContain("Payout if Yes");
    expect(html).toMatch(/data-bottom-tab="positions"[\s\S]*data-bottom-tab="outcomes"[\s\S]*data-bottom-tab="orders"/);
    expect(html).toContain('id="trade-outcomes"');
    expect(html).toContain(">Outcomes<");
    const tradeJs = readFileSync(join(root, "src/trade.js"), "utf8");
    expect(tradeJs).toContain('"No outcomes yet"');
    expect(tradeJs).toContain('"Available Size"');
    expect(tradeJs).toContain('"PNL (ROE %)"');
    expect(tradeJs).toContain("jumpToOutcome");
  });

  it("puts Order Book and Trades as word tabs in the book column", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const start = html.indexOf('class="trade-book"');
    const end = html.indexOf('class="trade-ticket"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pane = html.slice(start, end);
    expect(pane).toContain('data-book-tab="book"');
    expect(pane).toContain(">Order Book<");
    expect(pane).toContain('data-book-tab="trades"');
    expect(pane).toContain(">Trades<");
    expect(pane).toContain('id="book-prec"');
    expect(pane).toContain('id="book-unit"');
    expect(pane).toContain("Size (USDC)");
    expect(pane).toContain('id="trades-pane"');
    expect(pane).not.toMatch(/role="slider"/);
    expect(pane).not.toMatch(/pill/);
    expect(html.split('data-book-tab="trades"').length - 1).toBe(1);
  });

  it("keeps Market and Limit from scrolling; only Pro extras may overflow", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const js = readFileSync(join(root, "src/trade.js"), "utf8");
    expect(css).toMatch(/\.trade-ticket \{[\s\S]*?overflow: hidden/);
    expect(css).toMatch(/\.ticket \{[\s\S]*?overflow: hidden/);
    expect(css).toMatch(/\.ticket-scroll \{[\s\S]*?overflow-y: hidden/);
    expect(css).toMatch(/\.ticket:not\(\.has-pro-extra\) \.ticket-scroll \{[\s\S]*?overflow: hidden/);
    expect(css).toMatch(/\.ticket\.has-pro-extra \.ticket-scroll \{[\s\S]*?overflow-y: auto/);
    expect(css).toMatch(/\.ticket-foot \{[\s\S]*?flex: 0 0 auto/);
    expect(js).toContain('classList.toggle("has-pro-extra", proOn)');
  });
});
