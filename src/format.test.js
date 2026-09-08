import { describe, expect, it } from "vitest";
import { pnlClass } from "./format.js";

describe("pnlClass", () => {
  it("paints profit green, loss red, and zero/missing muted white", () => {
    expect(pnlClass(0.0212)).toBe("text-success");
    expect(pnlClass("1.5")).toBe("text-success");
    expect(pnlClass(-0.5)).toBe("text-danger");
    expect(pnlClass("-2")).toBe("text-danger");
    expect(pnlClass(0)).toBe("text-white");
    expect(pnlClass("0")).toBe("text-white");
    expect(pnlClass(null)).toBe("text-white");
    expect(pnlClass("")).toBe("text-white");
    expect(pnlClass("nope")).toBe("text-white");
  });
});
