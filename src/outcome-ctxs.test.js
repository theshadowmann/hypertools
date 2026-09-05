import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseOutcomeMarkets } from "./outcomes.js";
import {
  decodeHlCompressedJson,
  enrichOutcomeMarkets,
  indexSpotAssetCtxs,
  outcomeDayNotional,
  outcomeOpenInterestShares,
} from "./outcome-ctxs.js";

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
  ],
  questions: [],
};

describe("outcome day notional and open interest helpers", () => {
  it("reads Yes-side dayNtlVlm and averages Yes+No circulatingSupply like HL", () => {
    const yes = { dayNtlVlm: "1582.15", circulatingSupply: "400", prevDayPx: "0.06" };
    const no = { dayNtlVlm: "30010.8", circulatingSupply: "200" };
    expect(outcomeDayNotional(yes)).toBeCloseTo(1582.15);
    expect(outcomeOpenInterestShares(yes, no)).toBe(300);
    expect(outcomeDayNotional(null)).toBeNull();
    expect(outcomeDayNotional({ dayNtlVlm: "" })).toBeNull();
    expect(outcomeOpenInterestShares(null, no)).toBeNull();
    expect(outcomeOpenInterestShares({ circulatingSupply: "10" }, null)).toBe(5);
  });

  it("indexes sac snapshots by # coin without inventing rows", () => {
    const mapped = indexSpotAssetCtxs({
      "#12100": { dayNtlVlm: "100", circulatingSupply: "40" },
      "#12101": { coin: "#12101", dayNtlVlm: "20", circulatingSupply: "10" },
      junk: null,
    });
    expect(mapped["#12100"].dayNtlVlm).toBe("100");
    expect(mapped["#12101"].circulatingSupply).toBe("10");
    expect(mapped.junk).toBeUndefined();
    expect(indexSpotAssetCtxs(null)).toEqual({});
    expect(indexSpotAssetCtxs([])).toEqual({});
  });

  it("inflates the same raw-deflate + base64 envelope Hyperliquid sends on sac", async () => {
    const payload = {
      "#12100": { dayNtlVlm: "42.5", circulatingSupply: "80", prevDayPx: "0.4", markPx: "0.42" },
    };
    const b64 = deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64");
    const parsed = await decodeHlCompressedJson(b64);
    expect(parsed["#12100"].dayNtlVlm).toBe("42.5");
    expect(parsed["#12100"].circulatingSupply).toBe("80");
  });
});

describe("enrichOutcomeMarkets", () => {
  it("fills volume and OI from sac ctxs and leaves missing fields null", () => {
    const rows = parseOutcomeMarkets(meta, { "#12100": "0.42", "#12101": "0.58" });
    expect(rows[0].dayNtlVlm).toBeNull();
    expect(rows[0].openInterest).toBeNull();
    const filled = enrichOutcomeMarkets(rows, {
      "#12100": { dayNtlVlm: "1582.14864", circulatingSupply: "400.0", prevDayPx: "0.06268" },
      "#12101": { dayNtlVlm: "30010.85", circulatingSupply: "200.0" },
    });
    expect(filled[0].markPx).toBe("0.42");
    expect(filled[0].dayNtlVlm).toBeCloseTo(1582.14864);
    expect(filled[0].openInterest).toBe(300);
    expect(filled[0].prevDayPx).toBe("0.06268");
    const empty = enrichOutcomeMarkets(rows, {});
    expect(empty[0].dayNtlVlm).toBeNull();
    expect(empty[0].openInterest).toBeNull();
  });

  it("does not rewrite perp or spot rows", () => {
    const mixed = [
      { kind: "perp", coin: "BTC", dayNtlVlm: "9", openInterest: "3" },
      { kind: "spot", coin: "PURR/USDC", dayNtlVlm: "4", openInterest: null },
    ];
    const out = enrichOutcomeMarkets(mixed, { BTC: { dayNtlVlm: "1" } });
    expect(out[0].dayNtlVlm).toBe("9");
    expect(out[1].dayNtlVlm).toBe("4");
  });
});
