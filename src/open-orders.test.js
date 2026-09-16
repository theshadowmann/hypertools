import { describe, expect, it } from "vitest";
import {
  cancelAllCancels,
  histTabLabel,
  openOrdersTabLabel,
  setHistTabLabel,
  setOpenOrdersTabLabel,
} from "./open-orders.js";

describe("histTabLabel", () => {
  it("shows (n) only when count > 0", () => {
    expect(histTabLabel("Balances", 2)).toBe("Balances (2)");
    expect(histTabLabel("Positions", 0)).toBe("Positions");
    expect(histTabLabel("Outcomes", 1)).toBe("Outcomes (1)");
    expect(histTabLabel("Open Orders", 20)).toBe("Open Orders (20)");
    expect(histTabLabel("Open Orders", 0)).toBe("Open Orders");
    expect(histTabLabel("Open Orders", null)).toBe("Open Orders");
    expect(histTabLabel("Open Orders", -2)).toBe("Open Orders");
    expect(histTabLabel("Open Orders", "7")).toBe("Open Orders (7)");
  });

  it("writes the label onto a tab button", () => {
    const btn = { textContent: "Balances" };
    setHistTabLabel(btn, "Balances", 4);
    expect(btn.textContent).toBe("Balances (4)");
    setHistTabLabel(btn, "Balances", 0);
    expect(btn.textContent).toBe("Balances");
    setHistTabLabel(null, "Balances", 1);
  });
});

describe("openOrdersTabLabel", () => {
  it("delegates to histTabLabel for Open Orders", () => {
    expect(openOrdersTabLabel(20)).toBe("Open Orders (20)");
    expect(openOrdersTabLabel(3)).toBe("Open Orders (3)");
    expect(openOrdersTabLabel(0)).toBe("Open Orders");
    expect(openOrdersTabLabel(null)).toBe("Open Orders");
    expect(openOrdersTabLabel(-2)).toBe("Open Orders");
    expect(openOrdersTabLabel("7")).toBe("Open Orders (7)");
  });

  it("writes the label onto a tab button", () => {
    const btn = { textContent: "Open Orders" };
    setOpenOrdersTabLabel(btn, 4);
    expect(btn.textContent).toBe("Open Orders (4)");
    setOpenOrdersTabLabel(btn, 0);
    expect(btn.textContent).toBe("Open Orders");
    setOpenOrdersTabLabel(null, 1);
  });
});

describe("cancelAllCancels", () => {
  it("maps every listed order to {asset, oid} and skips junk", () => {
    const orders = [
      { coin: "PONS", oid: "11" },
      { coin: "ETH", oid: 22 },
      { coin: "NOPE", oid: 33 },
      { coin: "BTC", oid: 0 },
      { oid: 44 },
      null,
    ];
    const assetOf = (o) => ({ PONS: 101, ETH: 1, BTC: 0 }[o.coin]);
    expect(cancelAllCancels(orders, assetOf)).toEqual([
      { asset: 101, oid: 11 },
      { asset: 1, oid: 22 },
    ]);
    expect(cancelAllCancels([], assetOf)).toEqual([]);
  });
});
