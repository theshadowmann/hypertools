import { describe, expect, it } from "vitest";
import {
  fillDirectionClass,
  fillDirectionLabel,
  filterFillsByPage,
  formatFillTime,
  fmtUsdcAmt,
  fillTradeValue,
  sortFillsByTimeDesc,
} from "./fills.js";

describe("formatFillTime", () => {
  it("formats local M/D/YYYY - HH:MM:SS", () => {
    const ms = Date.UTC(2026, 8, 15, 21, 17, 15);
    // Local TZ dependent — only assert shape when local matches parts of Date
    const s = formatFillTime(ms);
    expect(s).toMatch(/^\d{1,2}\/\d{1,2}\/2026 - \d{2}:\d{2}:\d{2}$/);
  });
  it("returns em dash for bad input", () => {
    expect(formatFillTime(null)).toBe("—");
    expect(formatFillTime(0)).toBe("—");
  });
});

describe("fillDirectionLabel", () => {
  it("prefers API dir", () => {
    expect(fillDirectionLabel({ dir: "Close Long", side: "B" })).toBe("Close Long");
  });
  it("derives open/close from side + startPosition", () => {
    expect(fillDirectionLabel({ side: "B", startPosition: "0" })).toBe("Open Long");
    expect(fillDirectionLabel({ side: "B", startPosition: "-1.5" })).toBe("Close Short");
    expect(fillDirectionLabel({ side: "A", startPosition: "2" })).toBe("Close Long");
    expect(fillDirectionLabel({ side: "A", startPosition: "0" })).toBe("Open Short");
  });
  it("uses Buy/Sell for outcome fallback", () => {
    expect(fillDirectionLabel({ side: "B" }, { outcome: true })).toBe("Buy");
    expect(fillDirectionLabel({ side: "A" }, { outcome: true })).toBe("Sell");
  });
});

describe("fillDirectionClass", () => {
  it("maps HL directions to buy/sell colors", () => {
    expect(fillDirectionClass("Open Long")).toBe("text-buy");
    expect(fillDirectionClass("Close Short")).toBe("text-buy");
    expect(fillDirectionClass("Buy")).toBe("text-buy");
    expect(fillDirectionClass("Close Long")).toBe("text-sell");
    expect(fillDirectionClass("Open Short")).toBe("text-sell");
    expect(fillDirectionClass("Sell")).toBe("text-sell");
  });
});

describe("fmtUsdcAmt", () => {
  it("suffixes USDC and signs when asked", () => {
    expect(fmtUsdcAmt(920.12)).toBe("920.12 USDC");
    expect(fmtUsdcAmt(1.76, { signed: true })).toBe("+1.76 USDC");
    expect(fmtUsdcAmt(-0.1, { signed: true })).toBe("-0.10 USDC");
  });
});

describe("filterFillsByPage", () => {
  const rows = [{ coin: "BTC" }, { coin: "#1" }, { coin: "ETH" }, { coin: "+0" }];
  it("keeps perps on trade page", () => {
    expect(filterFillsByPage(rows, "trade").map((r) => r.coin)).toEqual(["BTC", "ETH"]);
  });
  it("keeps outcomes on outcome page", () => {
    expect(filterFillsByPage(rows, "outcome").map((r) => r.coin)).toEqual(["#1", "+0"]);
  });
  it("keeps all on portfolio", () => {
    expect(filterFillsByPage(rows, "portfolio")).toHaveLength(4);
  });
});

describe("sort + value", () => {
  it("sorts newest first and computes notional", () => {
    const sorted = sortFillsByTimeDesc([{ time: 1 }, { time: 3 }, { time: 2 }]);
    expect(sorted.map((f) => f.time)).toEqual([3, 2, 1]);
    expect(fillTradeValue({ px: "10", sz: "2.5" })).toBe(25);
  });
});
