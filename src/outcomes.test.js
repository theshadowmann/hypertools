import { describe, expect, it } from "vitest";
import {
  encodeOutcomeAsset,
  encodeOutcomeBalance,
  encodeOutcomeCoin,
  formatChancePct,
  formatOutcomeCountdown,
  formatOutcomeOdds,
  formatOutcomeTitle,
  formatOutcomeUtcLabel,
  isOutcomeCoin,
  isOutcomePageBalance,
  lookupUnderlyingPx,
  outcomeCategories,
  outcomeLegAsset,
  outcomeLegBalance,
  outcomeLegCoin,
  outcomeLegTvCoin,
  outcomeLegTvTickers,
  outcomePayout,
  outcomePositionMetrics,
  outcomePositionsFromSpot,
  outcomeSlugify,
  outcomeVenueBadge,
  parseOutcomeExpiryMs,
  parseOutcomeFields,
  parseOutcomeMarkets,
  roundOutcomePx,
} from "./outcomes.js";

const meta = {
  outcomes: [
    {
      outcome: 1210,
      name: "template:binaryPrice",
      description: "perp:BTC|priceDescription:BTC-USDC mark|seconds:1|threshold:100000|time:20261001-0000",
      sideSpecs: [{ name: "template:Yes" }, { name: "template:No" }],
      quoteToken: "USDC",
      venue: "out",
    },
    {
      outcome: 1209,
      name: "template:priceTouch",
      description: "perp:HYPE|priceDescription:HYPE-USDC perp mark|seconds:1|target:100|time:20261001-0000",
      sideSpecs: [{ name: "template:Yes" }, { name: "template:No" }],
      quoteToken: "USDC",
      venue: "out",
    },
    {
      outcome: 1228,
      name: "template:policyRateDecrease",
      description: "",
      sideSpecs: [{ name: "Yes" }, { name: "No" }],
      quoteToken: "USDC",
      venue: "out",
    },
  ],
  questions: [
    {
      question: 191,
      name: "template:policyRateDecision",
      description:
        "decisionDeadline:20261028-2359|decisionLabel:September 2026|institution:Federal Reserve's Open Market Committee|policyMeasure:the upper bound target range for the federal funds rate",
      fallbackOutcome: 1226,
      namedOutcomes: [1227, 1228, 1229],
      settledNamedOutcomes: [],
    },
  ],
};

const PRICE_TOUCH_TEMPLATE = {
  id: "priceTouch",
  role: { standaloneOutcome: { sideNames: ["Yes", "No"] } },
  name: "{perp} touches {target} by {time}",
  keywords: [
    ["perp", "hlPerp"],
    ["priceDescription", "string"],
    ["seconds", "uInt"],
    ["target", "uDecimal"],
    ["time", "dateTime"],
  ],
};

const BINARY_PRICE_TEMPLATE = {
  id: "binaryPrice",
  role: { standaloneOutcome: { sideNames: ["Yes", "No"] } },
  name: "{perp} above {threshold} at {time}?",
  keywords: [
    ["perp", "hlPerp"],
    ["priceDescription", "string"],
    ["seconds", "uInt"],
    ["threshold", "uDecimal"],
    ["time", "dateTime"],
  ],
};

const PONS = {
  outcome: 1288,
  name: "template:priceTouch",
  description: "perp:PONS|priceDescription:PONS-USDC perp mark|seconds:3|target:1|time:20260907-0600",
  sideSpecs: [{ name: "template:Yes" }, { name: "template:No" }],
  quoteToken: "USDC",
  venue: "out",
};

describe("HIP-4 Charting Library tickers", () => {
  it("slugifies the Hyperliquid PONS ticker from templates, never a BTC stand-in", () => {
    expect(formatOutcomeUtcLabel("20260907-0600")).toBe("Sep 7 at 6:00 AM UTC");
    expect(outcomeSlugify("PONS touches 1 by Sep 7 at 6:00 AM UTC-Yes")).toBe(
      "pons-touches-1-by-sep-7-at-600-am-utc-yes"
    );
    const tv = outcomeLegTvTickers(PONS, null, [PRICE_TOUCH_TEMPLATE]);
    expect(tv.yes).toBe("out:pons-touches-1-by-sep-7-at-600-am-utc-yes");
    expect(tv.no).toBe("out:pons-touches-1-by-sep-7-at-600-am-utc-no");
    expect(tv.yes).not.toMatch(/BTC/i);
    expect(outcomeLegTvTickers(PONS, null, []).yes).toBe("");
  });
});

describe("HIP-4 outcome encoding", () => {
  it("maps outcome id + side to # coin, + balance, and 100_000_000 asset id", () => {
    expect(encodeOutcomeCoin(1, 0)).toBe("#10");
    expect(encodeOutcomeCoin(1, 1)).toBe("#11");
    expect(encodeOutcomeBalance(1, 0)).toBe("+10");
    expect(encodeOutcomeAsset(1, 0)).toBe(100_000_010);
    expect(encodeOutcomeCoin(1210, 0)).toBe("#12100");
    expect(encodeOutcomeAsset(1210, 0)).toBe(100_012_100);
    expect(encodeOutcomeCoin(-1, 0)).toBe("");
    expect(encodeOutcomeCoin(1, 2)).toBe("");
  });
});

describe("outcome titles", () => {
  it("builds the question from live description fields only", () => {
    expect(formatOutcomeTitle(meta.outcomes[0])).toBe("BTC above 100000 on Oct 1, 2026 at 12:00 AM?");
    expect(formatOutcomeTitle(meta.outcomes[1])).toBe("HYPE touches 100 on Oct 1, 2026 at 12:00 AM?");
    expect(formatOutcomeTitle(meta.outcomes[2], meta.questions[0])).toContain("Federal Reserve's Open Market Committee");
    expect(formatOutcomeTitle(meta.outcomes[2], meta.questions[0])).toContain("September 2026");
  });

  it("parses pipe key:value descriptions", () => {
    expect(parseOutcomeFields("perp:xyz:CL|threshold:83.196|time:20260929-2100")).toEqual({
      perp: "xyz:CL",
      threshold: "83.196",
      time: "20260929-2100",
    });
  });
});

describe("parseOutcomeMarkets", () => {
  it("builds Yes-side rows from outcomeMeta + allMids without inventing prices", () => {
    const rows = parseOutcomeMarkets(meta, { "#12100": "0.42", "#12101": "0.58" });
    expect(rows).toHaveLength(3);
    const btc = rows.find((m) => m.outcomeId === 1210);
    expect(btc.kind).toBe("outcome");
    expect(btc.coin).toBe("#12100");
    expect(btc.noCoin).toBe("#12101");
    expect(btc.yesTvCoin).toBe("");
    expect(btc.noTvCoin).toBe("");
    expect(btc.asset).toBe(100_012_100);
    expect(btc.markPx).toBe("0.42");
    expect(btc.pair).toMatch(/BTC above 100000/);
    expect(btc.szDecimals).toBe(0);
    expect(btc.maxLeverage).toBeNull();
    const hype = rows.find((m) => m.outcomeId === 1209);
    expect(hype.markPx).toBeUndefined();
  });

  it("attaches Hyperliquid out: chart tickers from live templates without inventing prices", () => {
    const rows = parseOutcomeMarkets(
      { outcomes: [PONS, ...meta.outcomes], questions: meta.questions },
      { "#12880": "0.18", "#12881": "0.82", "#12100": "0.42", "#12101": "0.58" },
      {},
      [PRICE_TOUCH_TEMPLATE, BINARY_PRICE_TEMPLATE]
    );
    const pons = rows.find((m) => m.outcomeId === 1288);
    expect(pons.coin).toBe("#12880");
    expect(pons.noCoin).toBe("#12881");
    expect(pons.yesTvCoin).toBe("out:pons-touches-1-by-sep-7-at-600-am-utc-yes");
    expect(pons.noTvCoin).toBe("out:pons-touches-1-by-sep-7-at-600-am-utc-no");
    expect(outcomeLegTvCoin(pons, 0)).toBe("out:pons-touches-1-by-sep-7-at-600-am-utc-yes");
    expect(outcomeLegTvCoin(pons, 1)).toBe("out:pons-touches-1-by-sep-7-at-600-am-utc-no");
    expect(pons.markPx).toBe("0.18");
    const btc = rows.find((m) => m.outcomeId === 1210);
    expect(btc.yesTvCoin).toMatch(/^out:btc-above-100000-/);
    expect(btc.yesTvCoin).not.toMatch(/BTCUSDC/i);
  });

  it("returns nothing for empty API payloads", () => {
    expect(parseOutcomeMarkets(null, {})).toEqual([]);
    expect(parseOutcomeMarkets({ outcomes: [] }, {})).toEqual([]);
  });
});

describe("outcome coins and rounding", () => {
  it("treats # and + encodings as outcome coins", () => {
    expect(isOutcomeCoin("#12100")).toBe(true);
    expect(isOutcomeCoin("+12101")).toBe(true);
    expect(isOutcomeCoin("BTC")).toBe(false);
    expect(isOutcomeCoin("PURR/USDC")).toBe(false);
    expect(isOutcomePageBalance("USDC")).toBe(true);
    expect(isOutcomePageBalance("usdc")).toBe(true);
    expect(isOutcomePageBalance("+12100")).toBe(true);
    expect(isOutcomePageBalance("PURR")).toBe(false);
  });

  it("clamps probability to a 0.0001 tick in [0.001, 0.999]", () => {
    expect(roundOutcomePx(0.35424)).toBe(0.3542);
    expect(roundOutcomePx(0)).toBe(0.001);
    expect(roundOutcomePx(1.2)).toBe(0.999);
    expect(roundOutcomePx("x")).toBeNaN();
  });
});

describe("outcomePositionsFromSpot", () => {
  it("maps + balances onto live outcome markets without inventing rows", () => {
    const markets = parseOutcomeMarkets(meta, { "#12100": "0.42", "#12101": "0.58" });
    const rows = outcomePositionsFromSpot(
      [
        { coin: "+12100", total: "12", hold: "2", entryNtl: "4.8" },
        { coin: "+12101", total: "3", hold: "0" },
        { coin: "PURR", total: "9", hold: "0" },
        { coin: "+12100", total: "0", hold: "0" },
      ],
      markets
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].side).toBe("Yes");
    expect(rows[0].coin).toBe("+12100");
    expect(rows[0].available).toBe(10);
    expect(rows[0].markPx).toBe("0.42");
    expect(rows[0].title).toMatch(/BTC above 100000/);
    expect(rows[1].side).toBe("No");
    expect(rows[1].markPx).toBe("0.58");
    const metrics = outcomePositionMetrics(rows[0]);
    expect(metrics.entryPx).toBeCloseTo(0.4);
    expect(metrics.value).toBeCloseTo(5.04);
    expect(metrics.pnlPct).toBeCloseTo(5);
    expect(outcomePositionMetrics({ total: 10, markPx: 0.5 }).entryPx).toBeNaN();
  });
});

describe("outcome picker fields", () => {
  it("formats chance, countdown, and venue from live-shaped fields only", () => {
    expect(formatChancePct(0.8592)).toBe("85.9%");
    expect(formatChancePct(null)).toBe("—");
    expect(parseOutcomeExpiryMs({ time: "20261001-0000" })).toBe(Date.UTC(2026, 9, 1, 0, 0));
    expect(formatOutcomeCountdown(Date.UTC(2026, 9, 1, 0, 0), Date.UTC(2026, 8, 29, 12, 0))).toBe("1d 12h");
    expect(formatOutcomeCountdown(Date.UTC(2026, 8, 1, 0, 0), Date.UTC(2026, 8, 2, 0, 0))).toBe("Ended");
    expect(outcomeVenueBadge("out")).toBe("out");
    expect(outcomeVenueBadge("skew")).toBe("skew");
    expect(outcomeVenueBadge("")).toBe("");
    expect(outcomeCategories(meta)).toEqual([]);
  });

  it("looks up HIP-3 xyz marks without inventing prices", () => {
    expect(lookupUnderlyingPx("xyz:CL", { BTC: "1" }, { "xyz:CL": "82.94" })).toBe("82.94");
    expect(lookupUnderlyingPx("BTC", { BTC: "79000" }, {})).toBe("79000");
    expect(lookupUnderlyingPx("xyz:GOLD", {}, {})).toBeNull();
    const rows = parseOutcomeMarkets(meta, { BTC: "79000", "#12100": "0.42" }, { "xyz:CL": "82.9" });
    const btc = rows.find((m) => m.outcomeId === 1210);
    expect(btc.underlying).toBe("BTC");
    expect(btc.underlyingPx).toBe("79000");
    expect(btc.expiryMs).toBe(Date.UTC(2026, 9, 1, 0, 0));
  });
});

describe("Yes/No odds and wire ids", () => {
  it("formats 1/price odds and maps legs onto # / + / asset ids", () => {
    expect(formatOutcomeOdds(0.42)).toBe("2.4x");
    expect(formatOutcomeOdds(0.5)).toBe("2.0x");
    expect(formatOutcomeOdds(null)).toBe("—");
    expect(outcomePayout(10)).toBe(10);
    expect(Number.isFinite(outcomePayout(0))).toBe(false);
    const rows = parseOutcomeMarkets(meta, { "#12100": "0.42", "#12101": "0.58" }, {});
    const btc = rows.find((m) => m.outcomeId === 1210);
    expect(outcomeLegCoin(btc, 0)).toBe("#12100");
    expect(outcomeLegCoin(btc, 1)).toBe("#12101");
    expect(outcomeLegAsset(btc, 0)).toBe(100_012_100);
    expect(outcomeLegAsset(btc, 1)).toBe(100_012_101);
    expect(outcomeLegBalance(btc, 1)).toBe("+12101");
  });
});
