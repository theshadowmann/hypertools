import { describe, expect, it } from "vitest";
import {
  encodeOutcomeAsset,
  encodeOutcomeBalance,
  encodeOutcomeCoin,
  formatOutcomeTitle,
  parseOutcomeFields,
  parseOutcomeMarkets,
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
