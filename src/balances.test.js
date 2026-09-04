import { describe, expect, it } from "vitest";
import {
  availableBalance,
  balanceAssetLabel,
  balanceMarkPx,
  buildBalanceRows,
  formatPnlPct,
  iconCoinFromBalance,
  normalizeAbstraction,
  perpsAvailableCollateral,
  pnlPctFromEntry,
  spotUsdcParts,
  usdValue,
  usesSpotTradingBalance,
} from "./balances.js";

describe("balance math", () => {
  it("available is total minus hold", () => {
    expect(availableBalance(10, 2.5)).toBe(7.5);
    expect(availableBalance("4", "1")).toBe(3);
    expect(availableBalance(4, NaN)).toBe(4);
  });

  it("values size at the mark and never invents PNL", () => {
    expect(usdValue(2, 3)).toBe(6);
    expect(usdValue(2, NaN)).toBeNaN();
    expect(pnlPctFromEntry(100, 110)).toBeCloseTo(10);
    expect(pnlPctFromEntry(0, 110)).toBeNull();
    expect(pnlPctFromEntry(null, 110)).toBeNull();
    expect(formatPnlPct(null)).toBe("—");
    expect(formatPnlPct(10)).toBe("+10.00%");
    expect(formatPnlPct(-2.5)).toBe("-2.50%");
  });
});

describe("buildBalanceRows", () => {
  it("uses clearinghouse USDC and spot balances with mids", () => {
    const rows = buildBalanceRows({
      perps: { marginSummary: { accountValue: "50" }, withdrawable: "40" },
      spotBalances: [
        { coin: "PURR", total: "100", hold: "10", entryNtl: "8" },
        { coin: "DUST", total: "0.000000001", hold: "0" },
      ],
      mids: { PURR: "0.12" },
      hideSmall: false,
    });
    expect(rows[0]).toMatchObject({ coin: "USDC", total: 50, available: 40, value: 50, pnlPct: null });
    expect(rows[1].coin).toBe("PURR");
    expect(rows[1].available).toBe(90);
    expect(rows[1].value).toBeCloseTo(12);
    expect(rows[1].pnlPct).toBeCloseTo(50);
    expect(rows.some((r) => r.coin === "DUST")).toBe(false);
  });

  it("hides known small USD values and keeps unknown marks", () => {
    const rows = buildBalanceRows({
      perps: { marginSummary: { accountValue: "0.2" }, withdrawable: "0.2" },
      spotBalances: [{ coin: "ABC", total: "3", hold: "0" }],
      mids: {},
      markets: [],
      hideSmall: true,
    });
    expect(rows.find((r) => r.coin === "USDC")).toBeUndefined();
    expect(rows[0].coin).toBe("ABC");
    expect(Number.isFinite(rows[0].value)).toBe(false);
  });
});

describe("marks and icons", () => {
  it("resolves USDC to 1 and spot mids / meta marks", () => {
    expect(balanceMarkPx("USDC", {}, [])).toBe(1);
    expect(balanceMarkPx("HYPE", { HYPE: "20" }, [])).toBe(20);
    expect(balanceMarkPx("PURR", {}, [{ kind: "spot", base: "PURR", coin: "PURR/USDC", markPx: "0.12" }])).toBe(0.12);
    expect(balanceMarkPx("+12100", { "#12100": "0.42" }, [])).toBe(0.42);
    expect(
      balanceMarkPx("+12101", {}, [{ kind: "outcome", coin: "#12100", noCoin: "#12101", balanceCoin: "+12100", markPx: "0.42", noMarkPx: "0.58" }])
    ).toBe(0.58);
    expect(iconCoinFromBalance("PURR/USDC")).toBe("PURR");
  });
});

describe("account abstraction", () => {
  it("reads userAbstraction camelCase and extra quotes", () => {
    expect(normalizeAbstraction("unifiedAccount")).toBe("unifiedAccount");
    expect(normalizeAbstraction('"portfolioMargin"')).toBe("portfolioMargin");
    expect(normalizeAbstraction({ mode: "disabled" })).toBe("disabled");
  });

  it("uses spot USDC for unified and portfolio margin, perps withdrawable for standard", () => {
    const perps = { withdrawable: "0.187", marginSummary: { accountValue: "10.39" } };
    const spot = [{ coin: "USDC", total: "103.7689", hold: "10.186" }];
    expect(usesSpotTradingBalance("unifiedAccount", perps, spot)).toBe(true);
    expect(usesSpotTradingBalance("portfolioMargin", perps, spot)).toBe(true);
    expect(usesSpotTradingBalance("disabled", perps, spot)).toBe(false);
    expect(perpsAvailableCollateral({ abstraction: "unifiedAccount", perps, spotBalances: spot })).toBeCloseTo(93.5829);
    expect(perpsAvailableCollateral({ abstraction: "disabled", perps, spotBalances: spot })).toBeCloseTo(0.187);
  });

  it("infers unified when withdrawable is dust and spot holds USDC", () => {
    const perps = { withdrawable: "0.187" };
    const spot = [{ coin: "USDC", total: "48.43", hold: "10.2" }];
    expect(usesSpotTradingBalance(null, perps, spot)).toBe(true);
    expect(usesSpotTradingBalance("disabled", perps, spot)).toBe(false);
  });

  it("unified account has one USDC row from spot, not a synthetic perps duplicate", () => {
    const rows = buildBalanceRows({
      abstraction: "unifiedAccount",
      perps: { marginSummary: { accountValue: "10.3944" }, withdrawable: "0.187297" },
      spotBalances: [
        { coin: "USDC", total: "103.76893176", hold: "10.185933" },
        { coin: "+14090", total: "56", hold: "0", entryNtl: "52.24" },
      ],
      mids: { "#14090": "0.98" },
      markets: [
        {
          kind: "outcome",
          coin: "#14090",
          noCoin: "#14091",
          balanceCoin: "+14090",
          noBalanceCoin: "+14091",
          pair: "PONS above 1 on Sep 7?",
          underlying: "PONS",
          markPx: "0.98",
        },
      ],
      hideSmall: false,
    });
    const usdc = rows.filter((r) => r.coin === "USDC");
    expect(usdc).toHaveLength(1);
    expect(usdc[0].total).toBeCloseTo(103.76893176);
    expect(usdc[0].available).toBeCloseTo(93.58299876);
    expect(rows.find((r) => r.coin === "+14090").label).toBe("PONS above 1 on Sep 7? · Yes");
    expect(rows.find((r) => r.coin === "+14090").label).not.toMatch(/^\+14090$/);
  });

  it("labels outcome tokens with the market title, never a raw +id", () => {
    expect(balanceAssetLabel("USDC", [])).toBe("USDC");
    expect(
      balanceAssetLabel("+14090", [
        { kind: "outcome", coin: "#14090", balanceCoin: "+14090", noBalanceCoin: "+14091", pair: "PONS above 1 on Sep 7?" },
      ])
    ).toBe("PONS above 1 on Sep 7? · Yes");
    expect(balanceAssetLabel("+14091", [{ kind: "outcome", coin: "#14090", noCoin: "#14091", pair: "PONS above 1 on Sep 7?" }])).toBe(
      "PONS above 1 on Sep 7? · No"
    );
    expect(balanceAssetLabel("+14570", [])).toBe("Outcome · Yes");
    expect(balanceAssetLabel("#14571", [])).toBe("Outcome · No");
    expect(balanceAssetLabel("+14570", [])).not.toMatch(/14570/);
    expect(spotUsdcParts([{ coin: "USDC", total: "10", hold: "2" }]).available).toBe(8);
  });

  it("never emits two USDC rows when both perps and spot USDC exist", () => {
    const cases = [
      { abstraction: "disabled" },
      { abstraction: "unifiedAccount" },
      { abstraction: null },
      { abstraction: "dexAbstraction" },
    ];
    cases.forEach((extra) => {
      const rows = buildBalanceRows({
        ...extra,
        perps: { marginSummary: { accountValue: "71.2315" }, withdrawable: "0.705262" },
        spotBalances: [
          { coin: "USDC", total: "90.21820076", hold: "71.231528" },
          { coin: "+14570", total: "25", hold: "0", entryNtl: "17.75" },
        ],
        mids: { "#14570": "0.7" },
        markets: [
          {
            kind: "outcome",
            outcomeId: 1457,
            coin: "#14570",
            balanceCoin: "+14570",
            pair: "Example market?",
            markPx: "0.7",
          },
        ],
        hideSmall: false,
      });
      const usdc = rows.filter((r) => r.coin === "USDC");
      expect(usdc).toHaveLength(1);
      expect(usdc[0].total).toBeCloseTo(90.21820076);
      expect(usdc[0].available).toBeCloseTo(18.98667276);
      expect(rows.find((r) => r.coin === "+14570").label).toBe("Example market? · Yes");
      expect(rows.find((r) => r.coin === "+14570").label).not.toMatch(/^\+14570$/);
    });
  });
});
