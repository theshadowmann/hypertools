import { describe, expect, it } from "vitest";
import {
  availableBalance,
  balanceMarkPx,
  buildBalanceRows,
  formatPnlPct,
  iconCoinFromBalance,
  pnlPctFromEntry,
  usdValue,
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
