/**
 * Paint a range input's filled track from min up to the thumb.
 * `--fill` is a 0–100% stop for the CSS track gradient.
 */
export function rangeFillPercent(el) {
  if (!el) return 0;
  const min = Number(el.min);
  const max = Number(el.max);
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : 100;
  const span = hi - lo;
  const v = Number(el.value);
  if (!span || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, ((v - lo) / span) * 100));
}

export function paintRangeFill(el, ticksRoot) {
  if (!el || !el.style) return 0;
  const pct = rangeFillPercent(el);
  el.style.setProperty("--fill", `${pct}%`);
  if (ticksRoot && typeof ticksRoot.querySelectorAll === "function") {
    const ticks = ticksRoot.querySelectorAll("span");
    const n = ticks.length;
    ticks.forEach((span, i) => {
      const at = n <= 1 ? 0 : (i / (n - 1)) * 100;
      span.classList.toggle("on", at <= pct + 0.5);
    });
  }
  return pct;
}
