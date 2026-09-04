/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  LIMIT_CLOSE_TIP,
  SKIP_MARKET_CLOSE_KEY,
  buildOutcomePositionsTable,
  closeNotional,
  closeOutcomeCloseModal,
  closeSharesFromPct,
  isOutcomeCloseModalOpen,
  marketForOutcomeRow,
  openOutcomeCloseModal,
  outcomeCloseLeg,
  outcomeSizeLabel,
  pctFromShares,
  setSkipMarketCloseModal,
  sharesFromNotional,
  skipMarketCloseModal,
} from "./outcome-close.js";

afterEach(() => {
  closeOutcomeCloseModal();
  document.body.innerHTML = "";
});

describe("outcome close math", () => {
  it("labels size as qty + Yes/No and maps the held leg", () => {
    expect(outcomeSizeLabel({ total: 25, side: "Yes" })).toBe("25 Yes");
    expect(outcomeSizeLabel({ total: 10, side: "No" }, (n) => Number(n).toFixed(0))).toBe("10 No");
    expect(outcomeCloseLeg({ side: "Yes" })).toBe(0);
    expect(outcomeCloseLeg({ side: "No" })).toBe(1);
  });

  it("converts percent, notional, and shares without exceeding available", () => {
    expect(closeSharesFromPct(25, 100)).toBe(25);
    expect(closeSharesFromPct(25, 0)).toBe(0);
    expect(closeSharesFromPct(25, 50)).toBe(13);
    expect(pctFromShares(25, 25)).toBe(100);
    expect(closeNotional(25, 0.7385)).toBeCloseTo(18.4625);
    expect(sharesFromNotional(18.4625, 0.7385, 25)).toBe(25);
    expect(sharesFromNotional(100, 0.5, 10)).toBe(10);
    expect(sharesFromNotional("x", 0.5, 10)).toBe(0);
  });

  it("resolves the outcome market for a position row", () => {
    const markets = [
      { id: "outcome:1457:0", kind: "outcome", coin: "#14570", balanceCoin: "+14570", noCoin: "#14571" },
    ];
    expect(marketForOutcomeRow({ marketId: "outcome:1457:0" }, markets).coin).toBe("#14570");
    expect(marketForOutcomeRow({ coin: "+14570" }, markets).id).toBe("outcome:1457:0");
    expect(marketForOutcomeRow({ coin: "+99999" }, markets)).toBeNull();
  });

  it("persists Don't show this again on a storage stub", () => {
    const mem = {};
    const storage = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => {
        mem[k] = String(v);
      },
      removeItem: (k) => {
        delete mem[k];
      },
    };
    expect(skipMarketCloseModal(storage)).toBe(false);
    setSkipMarketCloseModal(true, storage);
    expect(mem[SKIP_MARKET_CLOSE_KEY]).toBe("1");
    expect(skipMarketCloseModal(storage)).toBe(true);
    setSkipMarketCloseModal(false, storage);
    expect(skipMarketCloseModal(storage)).toBe(false);
  });
});

describe("outcome close table and modals", () => {
  const row = {
    coin: "+14570",
    side: "Yes",
    title: "ZEC above 957.26 on Sep 5, 2026 at 6:00 AM?",
    total: 25,
    available: 25,
    markPx: 0.7385,
    entryNtl: 17.75,
    marketId: "outcome:1457:0",
  };

  it("renders Size as 25 Yes and cyan Limit + Market with the Limit tooltip", () => {
    const table = buildOutcomePositionsTable([row], { showClose: true });
    expect(table.querySelector("th").textContent).toBe("Market");
    expect([...table.querySelectorAll("th")].map((t) => t.textContent)).toContain("Available Size");
    expect(table.textContent).toContain("25 Yes");
    expect(table.textContent).not.toContain("+14570");
    const limit = [...table.querySelectorAll("button")].find((b) => b.textContent === "Limit");
    const market = [...table.querySelectorAll("button")].find((b) => b.textContent === "Market");
    expect(limit.title).toBe(LIMIT_CLOSE_TIP);
    expect(limit.className).toMatch(/orders-cancel/);
    expect(market.className).toMatch(/out-close/);
    expect(table.querySelectorAll(".out-close").length).toBe(2);
  });

  it("omits close actions when showClose is false", () => {
    const table = buildOutcomePositionsTable([row], { showClose: false });
    expect([...table.querySelectorAll("button")].some((b) => b.textContent === "Limit")).toBe(false);
    expect([...table.querySelectorAll("button")].some((b) => b.textContent === "Market")).toBe(false);
    expect(table.querySelector(".out-close")).toBeNull();
  });

  it("opens Limit Close with Mid, price, Confirm — not a ticket jump", () => {
    openOutcomeCloseModal({ kind: "limit", row, onSubmit: () => {} });
    expect(isOutcomeCloseModalOpen()).toBe(true);
    const modal = document.getElementById("ht-out-close-modal");
    expect(modal.textContent).toContain("Limit Close");
    expect(modal.textContent).toContain("This will send an order to close your position at the limit price.");
    expect(modal.textContent).toContain("Mid");
    expect(modal.textContent).toContain("Confirm");
    expect(modal.querySelector("#out-close-price")).toBeTruthy();
    expect(modal.querySelector("#out-close-pct").value).toBe("100");
    closeOutcomeCloseModal();
    expect(isOutcomeCloseModalOpen()).toBe(false);
  });

  it("opens Market Close with coral size, Don't show this again, and Market Close", () => {
    openOutcomeCloseModal({ kind: "market", row });
    const modal = document.getElementById("ht-out-close-modal");
    expect(modal.textContent).toContain("Market Close");
    expect(modal.textContent).toContain("This will attempt to immediately close the position.");
    expect(modal.textContent).toContain("25 Yes");
    expect(modal.textContent).toContain("Don't show this again");
    expect(modal.querySelector("#out-close-submit").textContent).toBe("Market Close");
    expect(modal.querySelector(".out-close-coral").textContent).toBe("25 Yes");
  });
});
