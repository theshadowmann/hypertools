import { describe, expect, it } from "vitest";
import {
  BUILDER_ADDRESS,
  BUILDER_FEE_TENTHS,
  assertCanTrade,
  builderParam,
  buildOrderPayload,
  buildOrderWire,
  roundPx,
  roundSz,
  sealOrderPayload,
  sizeFromMarginPct,
  toWire,
} from "./order-build.js";

describe("builder attachment", () => {
  it("uses the required builder address in lowercase", () => {
    expect(BUILDER_ADDRESS).toBe("0x999a4b5f268a8fbf33736feff360d462ad248dbf");
    expect(builderParam()).toEqual({
      b: "0x999a4b5f268a8fbf33736feff360d462ad248dbf",
      f: BUILDER_FEE_TENTHS,
    });
    expect(builderParam().b).toBe(builderParam().b.toLowerCase());
  });

  it("attaches builder on every order payload", () => {
    const wire = buildOrderWire({
      asset: 0,
      isBuy: true,
      size: 0.01,
      price: 95000,
      type: "limit",
      tif: "Gtc",
      szDecimals: 5,
    });
    const payload = buildOrderPayload(wire);
    expect(payload.builder).toEqual({
      b: "0x999a4b5f268a8fbf33736feff360d462ad248dbf",
      f: 10,
    });
    expect(payload.grouping).toBe("na");
    expect(payload.orders[0].t).toEqual({ limit: { tif: "Gtc" } });
  });

  it("ignores a mutated or query-supplied builder", () => {
    const wire = buildOrderWire({
      asset: 0,
      isBuy: true,
      size: 0.01,
      price: 95000,
      type: "limit",
      tif: "Gtc",
      szDecimals: 5,
    });
    const attacker = "0x0000000000000000000000000000000000000999";
    const payload = {
      orders: [wire],
      grouping: "na",
      builder: { b: attacker, f: 1 },
    };
    const sealed = sealOrderPayload(payload);
    expect(sealed.builder).toEqual({
      b: "0x999a4b5f268a8fbf33736feff360d462ad248dbf",
      f: 10,
    });
    sealed.builder.b = attacker;
    sealed.builder.f = 99;
    const sent = sealOrderPayload(sealed);
    expect(sent.builder.b).toBe("0x999a4b5f268a8fbf33736feff360d462ad248dbf");
    expect(sent.builder.f).toBe(10);
  });

  it("encodes market as aggressive IOC", () => {
    const wire = buildOrderWire({
      asset: 0,
      isBuy: false,
      size: 0.002,
      price: 90000,
      type: "market",
      szDecimals: 5,
    });
    expect(wire.t).toEqual({ limit: { tif: "Ioc" } });
    expect(wire.b).toBe(false);
    expect(wire.r).toBe(false);
  });

  it("encodes ALO post-only and reduce-only", () => {
    const wire = buildOrderWire({
      asset: 1,
      isBuy: true,
      size: 0.1,
      price: 3500,
      type: "limit",
      tif: "Alo",
      reduceOnly: true,
      szDecimals: 4,
    });
    expect(wire.t.limit.tif).toBe("Alo");
    expect(wire.r).toBe(true);
    expect(wire.a).toBe(1);
  });

  it("encodes stop / trigger orders", () => {
    const wire = buildOrderWire({
      asset: 0,
      isBuy: false,
      size: 0.01,
      type: "stop",
      triggerPx: 80000,
      tpsl: "sl",
      triggerIsMarket: true,
      szDecimals: 5,
    });
    expect(wire.t.trigger.tpsl).toBe("sl");
    expect(wire.t.trigger.isMarket).toBe(true);
    expect(wire.t.trigger.triggerPx).toBe("80000");
  });
});

describe("trade guards", () => {
  it("blocks paste-address mode", () => {
    expect(() => assertCanTrade("paste")).toThrow(/Connect a wallet/);
    expect(() => assertCanTrade(null)).toThrow(/Connect a wallet/);
    expect(() => assertCanTrade("wallet")).not.toThrow();
  });
});

describe("HIP-4 outcome order wire", () => {
  it("uses 100_000_000+ asset, integer size, and probability tick", () => {
    const wire = buildOrderWire({
      asset: 100_012_100,
      isBuy: true,
      size: 10.4,
      price: 0.35424,
      type: "limit",
      tif: "Gtc",
      szDecimals: 5,
    });
    expect(wire.a).toBe(100012100);
    expect(wire.b).toBe(true);
    expect(wire.s).toBe("10");
    expect(wire.p).toBe("0.3542");
    expect(wire.t).toEqual({ limit: { tif: "Gtc" } });
  });

  it("clamps outcome prices into [0.001, 0.999] and still seals builder last", () => {
    const hi = buildOrderWire({
      asset: 100_012_101,
      isBuy: false,
      size: 25,
      price: 1.4,
      type: "limit",
      tif: "Ioc",
    });
    expect(hi.a).toBe(100012101);
    expect(hi.p).toBe("0.999");
    expect(hi.s).toBe("25");
    expect(hi.t).toEqual({ limit: { tif: "Ioc" } });
    const attacker = "0x0000000000000000000000000000000000000999";
    const sealed = sealOrderPayload({
      orders: [hi],
      grouping: "na",
      builder: { b: attacker, f: 1 },
    });
    expect(sealed.builder).toEqual({
      b: "0x999a4b5f268a8fbf33736feff360d462ad248dbf",
      f: 10,
    });
  });
});

describe("rounding", () => {
  it("rounds BTC-style prices to 5 sig figs and 1 decimal (szDecimals 5)", () => {
    expect(roundPx(123456.789, 5)).toBe(123460);
    expect(roundPx(95000.44, 5)).toBe(95000);
    expect(toWire(roundPx(0.0123456, 0))).toBe("0.012346");
  });

  it("rounds size to szDecimals", () => {
    expect(roundSz(0.123456, 4)).toBe(0.1235);
    expect(toWire(roundSz(1.2, 5))).toBe("1.2");
  });

  it("converts margin percent to coin size", () => {
    expect(sizeFromMarginPct(1000, 100000, 50, 5)).toBe("0.005");
  });
});
