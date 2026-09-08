import { describe, expect, it } from "vitest";
import {
  aggregateLevels,
  bookPrecisions,
  defaultPrecision,
  formatPrec,
  formatSpreadLabel,
  formatTradeTime,
  mergeTrades,
  spreadParts,
  tradeHashHref,
  tradeIsBuy,
} from "./book.js";

describe("book precision", () => {
  it("offers decade steps around the mark", () => {
    const steps = bookPrecisions(100000);
    expect(steps).toContain(0.1);
    expect(steps).toContain(1);
    expect(steps).toContain(10);
    expect(steps).not.toContain(0.01);
  });

  it("defaults BTC-scale marks near 1", () => {
    expect(defaultPrecision(100000)).toBe(1);
    expect(formatPrec(0.01)).toBe("0.01");
    expect(formatPrec(1)).toBe("1");
  });
});

describe("aggregateLevels", () => {
  it("ceils asks and floors bids onto the step", () => {
    const asks = aggregateLevels(
      [
        { px: "100.001", sz: "1" },
        { px: "100.004", sz: "2" },
        { px: "100.02", sz: "3" },
      ],
      0.01,
      "ask"
    );
    expect(asks).toEqual([
      { px: 100.01, sz: 3 },
      { px: 100.02, sz: 3 },
    ]);
    const bids = aggregateLevels(
      [
        { px: "99.999", sz: "1" },
        { px: "99.991", sz: "2" },
        { px: "99.98", sz: "4" },
      ],
      0.01,
      "bid"
    );
    expect(bids[0].px).toBe(99.99);
    expect(bids[0].sz).toBe(3);
    expect(bids[1]).toEqual({ px: 99.98, sz: 4 });
  });
});

describe("spread", () => {
  it("formats abs and percent like [ 0.006 0.006% ]", () => {
    const parts = spreadParts(100, 100.006);
    expect(parts.abs).toBeCloseTo(0.006, 8);
    expect(parts.pct).toBeCloseTo(0.006, 3);
    expect(formatSpreadLabel(100, 100.006)).toMatch(/^\[ 0\.006 0\.006% \]$/);
    expect(formatSpreadLabel(NaN, 1)).toBe("—");
  });
});

describe("mergeTrades", () => {
  it("dedupes by tid/hash and keeps newest first", () => {
    const older = { tid: 1, hash: "0xaaa", time: 100, px: "1", sz: "1", side: "B" };
    const newer = { tid: 2, hash: "0xbbb", time: 200, px: "2", sz: "2", side: "A" };
    const dup = { tid: 2, hash: "0xbbb", time: 200, px: "2", sz: "2", side: "A" };
    const out = mergeTrades([older], [newer, dup]);
    expect(out.map((t) => t.tid)).toEqual([2, 1]);
  });
});

describe("trade helpers", () => {
  it("only links 32-byte explorer hashes", () => {
    const ok = "0x" + "ab".repeat(32);
    expect(tradeHashHref(ok)).toBe("https://app.hyperliquid.xyz/explorer/tx/" + ok);
    expect(tradeHashHref("0xabc")).toBeNull();
    expect(tradeHashHref("javascript:alert(1)")).toBeNull();
    expect(tradeHashHref("https://evil.example/tx")).toBeNull();
  });

  it("treats B as buy and A as sell", () => {
    expect(tradeIsBuy("B")).toBe(true);
    expect(tradeIsBuy("A")).toBe(false);
  });

  it("formats tape time as HH:MM:SS", () => {
    const t = Date.parse("2026-08-31T15:04:09");
    expect(formatTradeTime(t)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
