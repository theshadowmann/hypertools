/**
 * Paint a range input's filled track from min up to the thumb.
 * Chromium ignores custom properties on ::-webkit-slider-runnable-track,
 * so the gradient is applied on the input itself.
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

function cssVar(el, name, fallback) {
  if (typeof getComputedStyle !== "function") return fallback;
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export function paintRangeFill(el, ticksRoot) {
  if (!el || !el.style) return 0;
  const pct = rangeFillPercent(el);
  const fill = cssVar(el, "--accent-primary", "#06B6D4");
  const empty = cssVar(el, "--bg-input", "#1E293B");
  el.style.setProperty("--fill", `${pct}%`);
  el.style.backgroundImage = `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, ${empty} ${pct}%, ${empty} 100%)`;
  el.style.backgroundSize = "100% 4px";
  el.style.backgroundRepeat = "no-repeat";
  el.style.backgroundPosition = "center";
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
