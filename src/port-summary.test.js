import { describe, expect, it } from "vitest";
import {
  lastPnl,
  missingMoney,
  parsePortfolio,
  periodBlock,
  periodVolume,
  perpsEquity,
  pnlSeries,
  PORT_PERIODS,
  spotEquityUsd,
  stakingUsd,
  sum14DayVolume,
  sumVaultEquity,
  upnlSum,
} from "./port-summary.js";

const week = {
  accountValueHistory: [[1, "10"], [2, "12"]],
  pnlHistory: [[1, "1.5"], [2, "2.25"]],
  vlm: "100.5",
};

describe("parsePortfolio", () => {
  it("maps Info tuples and ignores junk", () => {
    const parsed = parsePortfolio([
      ["week", week],
      ["month", { pnlHistory: [[9, "3"]], vlm: "9" }],
      ["nope"],
      null,
    ]);
    expect(parsed.week.vlm).toBe("100.5");
    expect(lastPnl(parsed.week)).toBe(2.25);
    expect(periodVolume(parsed.month)).toBe(9);
    expect(parsePortfolio(null)).toEqual({});
    expect(parsePortfolio({})).toEqual({});
  });

  it("returns null PNL when the series is missing — never invents", () => {
    expect(lastPnl(null)).toBeNull();
    expect(lastPnl({ pnlHistory: [] })).toBeNull();
    expect(lastPnl({ pnlHistory: [["x", "nope"]] })).toBeNull();
    expect(missingMoney()).toBe("--");
  });

  it("builds a numeric pnl series from history pairs", () => {
    expect(pnlSeries(week)).toEqual([
      { t: 1, v: 1.5 },
      { t: 2, v: 2.25 },
    ]);
    expect(pnlSeries(null)).toEqual([]);
    expect(periodBlock({ week }, "week").vlm).toBe("100.5");
    expect(periodBlock({ week }, "month")).toBeNull();
  });
});

describe("volume and equity", () => {
  it("sums the last 14 userCross+userAdd days and ignores exchange", () => {
    const days = [];
    for (let i = 0; i < 16; i++) {
      days.push({ userCross: "1", userAdd: "2", exchange: "9999" });
    }
    expect(sum14DayVolume(days)).toBe(42);
    expect(sum14DayVolume(null)).toBeNull();
    expect(sum14DayVolume([])).toBeNull();
  });

  it("sums vault equity when present", () => {
    expect(sumVaultEquity([{ equity: "4" }, { vaultEquity: "6" }])).toBe(10);
    expect(sumVaultEquity([])).toBeNull();
    expect(sumVaultEquity(null)).toBeNull();
  });

  it("computes spot, perps, upnl, staking from live fields only", () => {
    expect(spotEquityUsd([{ coin: "USDC", total: "10" }, { coin: "HYPE", total: "2" }], { HYPE: "4" })).toBe(18);
    expect(spotEquityUsd(null, {})).toBe(0);
    expect(perpsEquity({ marginSummary: { accountValue: "33.1" } })).toBe(33.1);
    expect(perpsEquity({})).toBeNull();
    expect(
      upnlSum({
        assetPositions: [{ position: { unrealizedPnl: "1.5" } }, { position: { unrealizedPnl: "-0.5" } }],
      })
    ).toBe(1);
    expect(upnlSum({ assetPositions: [] })).toBeNull();
    expect(stakingUsd({ delegated: "2" }, "3")).toBe(6);
    expect(stakingUsd({ delegated: "2" }, null)).toBeNull();
    expect(stakingUsd(null, "3")).toBeNull();
  });

  it("keeps the three live portfolio periods", () => {
    expect(PORT_PERIODS.map((p) => p.id)).toEqual(["week", "month", "allTime"]);
  });
});
