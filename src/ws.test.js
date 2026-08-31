import { describe, expect, it } from "vitest";
import { matchSubscription } from "./ws.js";

describe("ws matchSubscription", () => {
  it("matches trades arrays by data[0].coin", () => {
    const sub = { type: "trades", coin: "BTC" };
    expect(
      matchSubscription(
        {
          channel: "trades",
          data: [{ coin: "BTC", side: "B", px: "1", sz: "0.1", time: 1, hash: "0x" + "ab".repeat(32), tid: 1 }],
        },
        sub
      )
    ).toBe(true);
    expect(
      matchSubscription(
        { channel: "trades", data: [{ coin: "ETH", side: "B", px: "1", sz: "0.1", time: 1 }] },
        sub
      )
    ).toBe(false);
  });

  it("still matches l2Book objects by coin", () => {
    expect(
      matchSubscription({ channel: "l2Book", data: { coin: "BTC", levels: [[], []] } }, { type: "l2Book", coin: "BTC" })
    ).toBe(true);
    expect(
      matchSubscription({ channel: "l2Book", data: { coin: "ETH", levels: [[], []] } }, { type: "l2Book", coin: "BTC" })
    ).toBe(false);
  });
});
