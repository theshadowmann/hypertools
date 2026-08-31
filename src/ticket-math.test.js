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
  it("does not show GTC / IOC / ALO in the order ticket", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const start = html.indexOf('id="ticket-form"');
    const end = html.indexOf('id="trade-balances"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const ticket = html.slice(start, end);
    expect(ticket).not.toMatch(/\bGTC\b/i);
    expect(ticket).not.toMatch(/\bIOC\b/i);
    expect(ticket).not.toMatch(/\bALO\b/i);
    expect(ticket).toContain("Buy / Long");
    expect(ticket).toContain("Sell / Short");
    expect(ticket).toContain("ticket-pct");
    expect(ticket).toContain("ticket-slip");
  });

  it("uses word nav Trade / Portfolio, not a pill slider", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toContain('id="nav-trade"');
    expect(html).toContain('id="nav-portfolio"');
    expect(html).toContain(">Portfolio<");
    expect(html).not.toMatch(/<select[^>]*id="market-select"/);
    expect(html).toContain('id="market-chip"');
    expect(html).toContain('id="market-picker"');
    expect(html).toContain("Favorites");
    expect(html).toContain("8h Funding");
  });
});
