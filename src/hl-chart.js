import { clear } from "./dom.js";
import { loadCandles } from "./api.js";

const BG = "#242525";
const GRID = "rgba(54, 55, 55, 0.45)";
const UP = "#00c853";
const DOWN = "#e57373";
const AXIS = "#A4A5A5";
const PAD = { top: 8, right: 48, bottom: 22, left: 4 };

export function formatAxisPx(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  const abs = Math.abs(x);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function drawCandles(ctx, bars, width, height) {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  if (!bars || !bars.length) return;

  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = Math.max(1, height - PAD.top - PAD.bottom);
  let lo = Infinity;
  let hi = -Infinity;
  bars.forEach((b) => {
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  });
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    hi = lo + 0.001;
  }
  const padPx = (hi - lo) * 0.06;
  lo -= padPx;
  hi += padPx;
  const span = hi - lo || 1;
  const slot = innerW / bars.length;
  const bodyW = Math.max(1, Math.min(7, slot * 0.7));

  function yOf(px) {
    return PAD.top + ((hi - px) / span) * innerH;
  }

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (innerH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y + 0.5);
    ctx.lineTo(width - PAD.right, y + 0.5);
    ctx.stroke();
    const px = hi - (span * i) / 4;
    ctx.fillStyle = AXIS;
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(formatAxisPx(px), width - PAD.right + 4, y);
  }

  bars.forEach((b, i) => {
    const x = PAD.left + slot * i + slot / 2;
    const up = b.close >= b.open;
    ctx.strokeStyle = up ? UP : DOWN;
    ctx.fillStyle = up ? UP : DOWN;
    ctx.beginPath();
    ctx.moveTo(x, yOf(b.high));
    ctx.lineTo(x, yOf(b.low));
    ctx.stroke();
    const y1 = yOf(b.open);
    const y2 = yOf(b.close);
    const top = Math.min(y1, y2);
    const h = Math.max(1, Math.abs(y2 - y1));
    ctx.fillRect(x - bodyW / 2, top, bodyW, h);
  });

  const last = bars[bars.length - 1];
  if (last) {
    const t = new Date(last.time * 1000);
    const label =
      t.getUTCHours().toString().padStart(2, "0") + ":" + t.getUTCMinutes().toString().padStart(2, "0");
    ctx.fillStyle = AXIS;
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(label, width - PAD.right, height - PAD.bottom + 6);
  }
}

export function mountHlChart(container, { coin, interval }) {
  if (!container) return;
  clear(container);
  const c = String(coin || "");
  if (!c) {
    const note = document.createElement("p");
    note.className = "tv-skip";
    note.textContent = "Select a market to load candles.";
    container.appendChild(note);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "hl-chart-host";
  const canvas = document.createElement("canvas");
  canvas.className = "hl-chart";
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  let bars = [];
  let ro = null;
  let cancelled = false;

  function paint() {
    const w = wrap.clientWidth || container.clientWidth || 320;
    const h = wrap.clientHeight || container.clientHeight || 240;
    const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCandles(ctx, bars, w, h);
  }

  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
  }

  wrap._hlChartTeardown = () => {
    cancelled = true;
    if (ro) ro.disconnect();
  };

  loadCandles(c, interval)
    .then((rows) => {
      if (cancelled) return;
      bars = rows || [];
      if (!bars.length) {
        const note = document.createElement("p");
        note.className = "tv-skip";
        note.textContent = "No candle history for this market.";
        clear(container);
        container.appendChild(note);
        return;
      }
      paint();
    })
    .catch(() => {
      if (cancelled) return;
      const note = document.createElement("p");
      note.className = "tv-skip";
      note.textContent = "Could not load Hyperliquid candles.";
      clear(container);
      container.appendChild(note);
    });

  paint();
}
