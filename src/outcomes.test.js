import { describe, expect, it } from "vitest";
import {
  encodeOutcomeAsset,
  encodeOutcomeBalance,
  encodeOutcomeCoin,
  formatChancePct,
  formatOutcomeCountdown,
  formatOutcomeTitle,
  isOutcomeCoin,
  lookupUnderlyingPx,
  outcomeCategories,
  outcomePositionsFromSpot,
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
    expect(btc.asset).toBe(100_012_100);
    expect(btc.markPx).toBe("0.42");
    expect(btc.pair).toMatch(/BTC above 100000/);
    expect(btc.szDecimals).toBe(0);
    expect(btc.maxLeverage).toBeNull();
    const hype = rows.find((m) => m.outcomeId === 1209);
    expect(hype.markPx).toBeUndefined();
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
