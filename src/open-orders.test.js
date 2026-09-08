import { describe, expect, it } from "vitest";
import { cancelAllCancels, openOrdersTabLabel, setOpenOrdersTabLabel } from "./open-orders.js";

describe("openOrdersTabLabel", () => {
  it("always includes the count, including zero", () => {
    expect(openOrdersTabLabel(20)).toBe("Open Orders (20)");
    expect(openOrdersTabLabel(3)).toBe("Open Orders (3)");
    expect(openOrdersTabLabel(0)).toBe("Open Orders (0)");
    expect(openOrdersTabLabel(null)).toBe("Open Orders (0)");
    expect(openOrdersTabLabel(-2)).toBe("Open Orders (0)");
    expect(openOrdersTabLabel("7")).toBe("Open Orders (7)");
  });

  it("writes the label onto a tab button", () => {
    const btn = { textContent: "Open Orders" };
    setOpenOrdersTabLabel(btn, 4);
    expect(btn.textContent).toBe("Open Orders (4)");
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
