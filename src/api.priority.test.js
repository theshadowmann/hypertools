import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("hlInfo priority queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs critical requests ahead of queued bulk", async () => {
    const order = [];
    let resolveBulk;
    const bulkGate = new Promise((r) => {
      resolveBulk = r;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        order.push(body.type);
        if (body.type === "bulkSlow") {
          await bulkGate;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ type: body.type }),
        };
      })
    );

    const { hlInfo } = await import("./api.js");

    const bulkP = hlInfo({ type: "bulkSlow" });
    // Let bulk claim a slot.
    await Promise.resolve();
    await Promise.resolve();

    const critP = hlInfo({ type: "clearinghouseState", user: "0x1" }, { priority: "critical" });
    const bulk2P = hlInfo({ type: "candleSnapshot" });

    // Give the queue a turn to schedule critical before second bulk starts.
    await Promise.resolve();
    await Promise.resolve();

    resolveBulk();
    await Promise.all([bulkP, critP, bulk2P]);

    const critIdx = order.indexOf("clearinghouseState");
    const candleIdx = order.indexOf("candleSnapshot");
    expect(critIdx).toBeGreaterThanOrEqual(0);
    expect(candleIdx).toBeGreaterThanOrEqual(0);
    // Critical must start before the second bulk item.
    expect(critIdx).toBeLessThan(candleIdx);
  });

  it("loadAccountCore only fetches clearinghouse + abstraction", async () => {
    const types = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        types.push(body.type);
        return {
          ok: true,
          status: 200,
          json: async () =>
            body.type === "spotClearinghouseState"
              ? { balances: [] }
              : body.type === "clearinghouseState"
                ? { assetPositions: [], withdrawable: "1" }
                : "unifiedAccount",
        };
      })
    );
    const { loadAccountCore } = await import("./api.js");
    const { data, errors } = await loadAccountCore("0xabc");
    expect(errors).toEqual([]);
    expect(types.sort()).toEqual(
      ["clearinghouseState", "spotClearinghouseState", "userAbstraction"].sort()
    );
    expect(data.perps).toBeTruthy();
    expect(data.spot).toBeTruthy();
    expect(data.openOrders).toEqual([]);
    expect(data.portfolio).toBeNull();
  });
});