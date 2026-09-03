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
  formatTpslField,
  sizeFromAvailablePct,
  tpslMovePct,
  tpslPriceFromPct,
  tpslPriceFromUsd,
  tpslRefPx,
  tpslUsdFromPrice,
  scaleSizeWeights,
  twapMinutesFromParts,
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
    expect(tvSymbol("out:pons-touches-1-by-sep-7-at-600-am-utc-yes", "outcome")).toBe(
      "HYPERLIQUID:out:pons-touches-1-by-sep-7-at-600-am-utc-yes"
    );
    expect(tvSymbol("out:pons-touches-1-by-sep-7-at-600-am-utc-no", "outcome")).toBe(
      "HYPERLIQUID:out:pons-touches-1-by-sep-7-at-600-am-utc-no"
    );
    expect(String(tvSymbol("out:pons-touches-1-by-sep-7-at-600-am-utc-yes", "outcome"))).not.toMatch(/BTC/i);
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
    expect(ticket).toContain("Reduce Only");
    expect(ticket).toContain("Take Profit / Stop Loss");
    expect(ticket).toContain('placeholder="TP Price"');
    expect(ticket).toContain('placeholder="SL Price"');
    expect(ticket).toContain(">Gain<");
    expect(ticket).toContain(">Loss<");
    expect(ticket).toContain('id="ticket-tp-gain"');
    expect(ticket).toContain('id="ticket-sl-loss"');
    expect(ticket).toContain('id="ticket-tp-unit"');
    expect(ticket).toContain('id="ticket-sl-unit"');
    expect(ticket).toContain('id="ticket-tpsl-pad"');
    expect(ticket).toContain('class="tpsl-pad"');
    expect(ticket).toContain('class="tpsl-grid is-idle"');
    expect(ticket).not.toContain('class="hidden tpsl-grid"');
    expect(ticket).not.toMatch(/ticket-label">Take profit</);
    expect(ticket).not.toMatch(/ticket-label">Stop loss</);
    expect(html).toContain('id="market-chip-icon"');
    expect(html).toMatch(
      /id="market-chip-pair">[\s\S]*class="chip-chevron"[\s\S]*id="market-chip-lev" class="lev-badge"/
    );
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
    expect(html).not.toContain('class="trade-iv"');
    expect(html).not.toContain("data-interval");
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

  it("packs Market, Limit, Scale, and TWAP without a ticket scrollbar", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const js = readFileSync(join(root, "src/trade.js"), "utf8");
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(css).toMatch(/\.trade-ticket \{[\s\S]*?overflow: hidden/);
    expect(css).toMatch(/\.ticket \{[\s\S]*?overflow: hidden/);
    expect(css).toMatch(/\.ticket-scroll \{[\s\S]*?overflow-y: hidden/);
    expect(css).toMatch(/\.ticket:not\(\.has-pro-extra\) \.ticket-scroll \{[\s\S]*?overflow: hidden/);
    expect(css).toMatch(/\.ticket\.has-pro-extra \.ticket-scroll \{[\s\S]*?overflow: visible/);
    expect(css).toMatch(/\.ticket\.has-pro-extra \.ticket-scroll \{[\s\S]*?flex: 0 0 auto/);
    expect(css).toMatch(/\.ticket\.has-pro-extra \.ticket-core-tail \{[\s\S]*?overflow: visible/);
    expect(css).toMatch(/\.ticket\.has-pro-extra\.has-tpsl-extra \.ticket-core-tail \{[\s\S]*?overflow: visible/);
    expect(css).not.toMatch(/\.ticket\.has-pro-extra \.ticket-scroll \{[\s\S]*?overflow-y:\s*auto/);
    expect(html).toContain('placeholder="Start (USDC)"');
    expect(html).toContain('placeholder="End (USDC)"');
    expect(html).toContain('placeholder="Total Orders"');
    expect(html).toContain('id="ticket-count"');
    expect(css).toMatch(/\.tpsl-pad \{[\s\S]*?min-height: 56px/);
    expect(css).toMatch(/\.tpsl-grid\.is-idle \{[\s\S]*?visibility: hidden/);
    expect(css).toMatch(/\.chk-row \{[\s\S]*?flex-direction: column/);
    expect(js).toContain("setTpslOpen");
    expect(css).toMatch(/grid-template-columns: minmax\(0, 1fr\) 248px 420px/);
    expect(css).toMatch(/\.trade-ticket \{[\s\S]*?grid-row: 1 \/ -1/);
    expect(html).toContain('placeholder="Day(s)"');
    expect(html).toContain('placeholder="Hour(s)"');
    expect(html).toContain('placeholder="Min(s)"');
    expect(html).toContain('value="30"');
    expect(html).toContain("Running Time (5m - 7d)");
    expect(html).not.toContain(">Minutes<");
    expect(html).toContain("Total Orders");
    expect(html).toContain("Size Skew");
    expect(html).toContain('id="ticket-skew"');
    expect(html).toContain('id="ticket-random-lbl"');
    expect(html).toContain("Randomize");
    expect(html).not.toContain("Randomize slices");
    expect(html).not.toContain("Advanced Settings");
    expect(css).toMatch(/\.ticket-foot \{[\s\S]*?flex: 0 0 auto/);
    expect(css).toMatch(/html\.desk,[\s\S]*?overflow: hidden/);
    expect(css).toMatch(/\.trade-shell \{[\s\S]*?overflow: hidden/);
    expect(js).toContain('classList.toggle("has-pro-extra", proOn)');
    expect(js).toContain("const packPad = tpslChk");
    expect(js).toContain('classList.toggle("has-tpsl-extra", packPad)');
    expect(js).toContain('classList.toggle("is-twap", next === "twap")');
    expect(js).toContain('sizeK.textContent = next === "twap" ? "Total Size" : "Size"');
    expect(js).toContain('next === "scale"');
    expect(js).toContain("skew: fieldValue(\"ticket-skew\") || 1");
    expect(css).toMatch(/\.ticket\.has-tpsl-extra \.ticket-core-tail \{[\s\S]*?overflow: hidden/);
    expect(css).not.toMatch(/\.ticket\.has-tpsl-extra \.ticket-core-tail \{[\s\S]*?overflow-y:\s*auto/);
    expect(css).toMatch(/\.tpsl-grid \{[\s\S]*?display:\s*grid/);
    expect(css).toMatch(/\.tpsl-grid \{[\s\S]*?grid-template-columns:/);
    expect(js).toContain("ticket-tp-gain");
    expect(js).toContain("ticket-sl-loss");
    expect(css).toMatch(/\.chk\.hidden \{[\s\S]*?display: none/);
    const mainJs = readFileSync(join(root, "src/main.js"), "utf8");
    expect(mainJs).toContain('classList.toggle("desk", onDesk)');
  });

  it("drops hist table row rules and dotted underlines, keeps the tab hairline", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const js = readFileSync(join(root, "src/trade.js"), "utf8");
    expect(css).toMatch(/\.hist-tabs \{[\s\S]*?border-bottom: 1px solid var\(--border-color\)/);
    expect(css).toMatch(/\.bal-table td \{[\s\S]*?border: 0/);
    expect(css).not.toMatch(/\.bal-table td \{[\s\S]*?border-top: 1px solid var\(--hair\)/);
    expect(css).toMatch(/\.hist-body th,[\s\S]*?border: 0/);
    expect(css).toMatch(/\.hist-body th,[\s\S]*?text-decoration: none/);
    expect(js).not.toContain("border-t border-chrome");
    expect(js).toContain('{ class: "bal-table" }');
  });
});

describe("TP/SL gain and loss", () => {
  it("uses limit price when set, otherwise mark", () => {
    expect(tpslRefPx(100, 99)).toBe(100);
    expect(tpslRefPx("", 99)).toBe(99);
    expect(tpslRefPx(0, 50)).toBe(50);
  });

  it("converts trigger price to gain/loss percent and back", () => {
    expect(tpslMovePct(100, 110, true, "tp")).toBeCloseTo(10);
    expect(tpslMovePct(100, 90, true, "sl")).toBeCloseTo(10);
    expect(tpslMovePct(100, 90, false, "tp")).toBeCloseTo(10);
    expect(tpslMovePct(100, 110, false, "sl")).toBeCloseTo(10);
    expect(tpslPriceFromPct(100, 10, true, "tp")).toBeCloseTo(110);
    expect(tpslPriceFromPct(100, 10, true, "sl")).toBeCloseTo(90);
    expect(tpslPriceFromPct(100, 10, false, "tp")).toBeCloseTo(90);
    expect(tpslPriceFromPct(100, 10, false, "sl")).toBeCloseTo(110);
  });

  it("converts trigger price to dollar PnL when size is known", () => {
    expect(tpslUsdFromPrice(100, 110, 2, true, "tp")).toBeCloseTo(20);
    expect(tpslUsdFromPrice(100, 90, 2, true, "sl")).toBeCloseTo(20);
    expect(tpslPriceFromUsd(100, 20, 2, true, "tp")).toBeCloseTo(110);
    expect(tpslPriceFromUsd(100, 20, 2, true, "sl")).toBeCloseTo(90);
    expect(formatTpslField(10)).toBe("10");
    expect(formatTpslField(1.25)).toBe("1.25");
  });
});

describe("TWAP running time and scale skew", () => {
  it("converts days/hours/mins to clamped minutes", () => {
    expect(twapMinutesFromParts("", "", "30")).toBe(30);
    expect(twapMinutesFromParts("", "", "")).toBe(30);
    expect(twapMinutesFromParts("", "1", "")).toBe(60);
    expect(twapMinutesFromParts("1", "", "")).toBe(1440);
    expect(twapMinutesFromParts("", "", "1")).toBe(5);
    expect(twapMinutesFromParts("8", "", "")).toBe(7 * 24 * 60);
  });

  it("keeps equal sizes at skew 1 and weights the end when skew > 1", () => {
    const flat = scaleSizeWeights(4, 1);
    expect(flat.every((w) => Math.abs(w - 0.25) < 1e-9)).toBe(true);
    const up = scaleSizeWeights(2, 2);
    expect(up[1]).toBeGreaterThan(up[0]);
    expect(up[0] + up[1]).toBeCloseTo(1);
  });
});
