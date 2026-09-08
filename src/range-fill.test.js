/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { paintRangeFill, rangeFillPercent } from "./range-fill.js";

describe("range fill", () => {
  it("maps the thumb between min and max to 0–100%", () => {
    const el = document.createElement("input");
    el.type = "range";
    el.min = "0";
    el.max = "100";
    el.value = "50";
    expect(rangeFillPercent(el)).toBe(50);
    el.value = "0";
    expect(rangeFillPercent(el)).toBe(0);
    el.min = "10";
    el.max = "20";
    el.value = "15";
    expect(rangeFillPercent(el)).toBe(50);
  });

  it("sets --fill and lights ticks at or left of the thumb", () => {
    const el = document.createElement("input");
    el.type = "range";
    el.min = "0";
    el.max = "100";
    el.value = "75";
    const ticks = document.createElement("div");
    ticks.innerHTML = "<span></span><span></span><span></span><span></span><span></span>";
    expect(paintRangeFill(el, ticks)).toBe(75);
    expect(el.style.getPropertyValue("--fill")).toBe("75%");
    expect(el.style.backgroundImage).toContain("75%");
    expect(el.style.backgroundImage).toMatch(/#06B6D4/);
    expect(el.style.backgroundImage).not.toMatch(/#10B981|#00c853|#7dd3c0/i);
    const on = [...ticks.querySelectorAll("span")].map((s) => s.classList.contains("on"));
    expect(on).toEqual([true, true, true, true, false]);
  });
});
