import { describe, expect, it } from "vitest";
import {
  collectActiveTwaps,
  collectHistoryTwaps,
  formatHms,
  isTwapActiveStatus,
  isTwapStillRunning,
  latestTwapHistoryById,
  twapAvgPx,
  twapHistoryRuntimeLabel,
  twapMaxMinLabel,
  twapRunningLabel,
  twapStatusLabel,
  twapTriggerPx,
  unwrapTwapSliceFills,
} from "./twap-hist.js";

describe("formatHms", () => {
  it("pads HH:MM:SS", () => {
    expect(formatHms(0)).toBe("00:00:00");
    expect(formatHms(41)).toBe("00:00:41");
    expect(formatHms(30 * 60)).toBe("00:30:00");
    expect(formatHms(3661)).toBe("01:01:01");
  });
});

describe("twapAvgPx / trigger / maxmin", () => {
  it("computes avg from executedNtl / executedSz", () => {
    expect(twapAvgPx({ executedNtl: "12.1528", executedSz: "0.00016" })).toBeCloseTo(75955, 0);
    expect(twapAvgPx({ executedNtl: "0", executedSz: "0" })).toBeNull();
    expect(twapAvgPx({})).toBeNull();
  });

  it("reads trigger.px and stopPx for max/min fallback", () => {
    expect(twapTriggerPx({ trigger: { px: "70000", above: true } })).toBe("70000");
    expect(twapTriggerPx({ trigger: null })).toBeNull();
    expect(twapMaxMinLabel({})).toBe("—");
    expect(twapMaxMinLabel({ stopPx: "80000" })).toBe("80,000.00");
    expect(twapMaxMinLabel({ minPx: "1", maxPx: "2" })).toBe("1.00 / 2.00");
  });
});

describe("status helpers", () => {
  it("detects active and labels status", () => {
    expect(isTwapActiveStatus("activated")).toBe(true);
    expect(isTwapActiveStatus("waitingForTrigger")).toBe(true);
    expect(isTwapActiveStatus("terminated")).toBe(false);
    expect(twapStatusLabel({ status: { status: "terminated" } })).toBe("Terminated");
    expect(twapStatusLabel({ status: { status: "activated" } })).toBe("Activated");
  });
});

describe("runtime labels", () => {
  it("formats running / total for active", () => {
    const start = Date.UTC(2026, 8, 15, 22, 51, 0);
    const now = start + 41_000;
    expect(twapRunningLabel({ timestamp: start, minutes: 30 }, now)).toBe("00:00:41 / 00:30:00");
  });

  it("uses planned duration for activated history rows", () => {
    expect(
      twapHistoryRuntimeLabel({
        time: 1_726_000_000,
        state: { timestamp: 1_726_000_000_000, minutes: 30 },
        status: { status: "activated" },
      })
    ).toBe("00:30:00");
  });

  it("uses record.time − timestamp for terminated when sensible", () => {
    const start = 1_726_000_000_000;
    const endSec = start / 1000 + 119;
    expect(
      twapHistoryRuntimeLabel({
        time: endSec,
        state: { timestamp: start, minutes: 30 },
        status: { status: "terminated" },
      })
    ).toBe("00:01:59");
  });
});

describe("collect / unwrap", () => {
  it("uses live array as authoritative Active set (ignores hist activated)", () => {
    const live = [{ id: 1, state: { coin: "BTC", sz: "0.002", timestamp: 100, minutes: 30 } }];
    const hist = [
      { twapId: 1, time: 1, state: { coin: "BTC", sz: "0.002", timestamp: 100, minutes: 30 }, status: { status: "activated" } },
      { twapId: 2, time: 2, state: { coin: "ETH", sz: "1", timestamp: 50, minutes: 10 }, status: { status: "terminated" } },
      { twapId: 3, time: 3, state: { coin: "SOL", sz: "2", timestamp: 200, minutes: 5 }, status: { status: "activated" } },
    ];
    const active = collectActiveTwaps(live, hist);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(1);
    expect(active[0].source).toBe("live");
    const emptyLive = collectActiveTwaps([], hist);
    expect(emptyLive).toHaveLength(0);
  });

  it("history fallback uses latest status per twapId (drops stale activated)", () => {
    const start = Date.UTC(2026, 8, 15, 22, 0, 0);
    const now = start + 5 * 60_000;
    const hist = [
      {
        twapId: 10,
        time: start / 1000,
        state: { coin: "BTC", sz: "0.002", executedSz: "0", timestamp: start, minutes: 30 },
        status: { status: "activated" },
      },
      {
        twapId: 10,
        time: start / 1000 + 120,
        state: { coin: "BTC", sz: "0.002", executedSz: "0.001", timestamp: start, minutes: 30 },
        status: { status: "terminated" },
      },
      {
        twapId: 11,
        time: start / 1000 + 60,
        state: { coin: "ETH", sz: "1", executedSz: "0", timestamp: start + 60_000, minutes: 30 },
        status: { status: "activated" },
      },
    ];
    const latest = latestTwapHistoryById(hist);
    expect(latest.get("id:10").status.status).toBe("terminated");
    expect(latest.get("id:11").status.status).toBe("activated");
    const active = collectActiveTwaps(null, hist, now);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(11);
    expect(active[0].source).toBe("hist");
    const histRows = collectHistoryTwaps(hist);
    expect(histRows).toHaveLength(3);
  });

  it("history fallback excludes activated past duration or fully filled", () => {
    const start = Date.UTC(2026, 8, 15, 20, 0, 0);
    const now = start + 40 * 60_000;
    expect(isTwapStillRunning({ timestamp: start, minutes: 30, sz: "1", executedSz: "0" }, now)).toBe(false);
    expect(isTwapStillRunning({ timestamp: start, minutes: 60, sz: "1", executedSz: "1" }, now)).toBe(false);
    expect(isTwapStillRunning({ timestamp: start, minutes: 60, sz: "1", executedSz: "0.2" }, now)).toBe(true);

    const hist = [
      {
        twapId: 20,
        time: start / 1000,
        state: { coin: "BTC", sz: "1", executedSz: "0", timestamp: start, minutes: 30 },
        status: { status: "activated" },
      },
      {
        twapId: 21,
        time: start / 1000,
        state: { coin: "ETH", sz: "2", executedSz: "2", timestamp: start, minutes: 60 },
        status: { status: "activated" },
      },
    ];
    expect(collectActiveTwaps(null, hist, now)).toHaveLength(0);
  });

  it("unwraps slice fills", () => {
    const rows = unwrapTwapSliceFills([
      { twapId: 9, fill: { coin: "BTC", px: "1", sz: "0.1", time: 1 } },
      { coin: "ETH", px: "2", sz: "1", time: 2, twapId: 8 },
    ]);
    expect(rows[0].coin).toBe("BTC");
    expect(rows[0].twapId).toBe(9);
    expect(rows[1].coin).toBe("ETH");
  });
});
