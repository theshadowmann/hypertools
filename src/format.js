export function num(raw) {
  if (raw == null || raw === "") return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function fmtUsd(raw, opts = {}) {
  if (raw == null || raw === "") return "—";
  const n = num(raw);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs === 0 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = opts.signed && n > 0 ? "+" : "";
  return sign + "$" + body;
}

export function fmtQty(raw) {
  if (raw == null || raw === "") return "—";
  const n = num(raw);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs === 0 ? 2 : abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function fmtPx(raw, withDollar = true) {
  if (raw == null || raw === "") return "—";
  const n = num(raw);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return withDollar ? "$" + body : body;
}

export function fmtRoe(raw) {
  if (raw == null || raw === "") return "—";
  const n = num(raw);
  if (!Number.isFinite(n)) return "—";
  const pct = n * 100;
  const sign = pct > 0 ? "+" : "";
  return (
    sign +
    pct.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    "%"
  );
}

export function fmtHype(raw) {
  if (raw == null || raw === "") return "—";
  const n = num(raw);
  if (!Number.isFinite(n)) return "—";
  return fmtQty(raw) + " HYPE";
}

export function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr || "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function pnlClass(raw) {
  const n = num(raw);
  if (!Number.isFinite(n) || n === 0) return "text-white";
  return n > 0 ? "text-success" : "text-danger";
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatLocalTime(ms) {
  const n = num(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    return new Date(n).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function formatClock(ms) {
  const n = num(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    return new Date(n).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}
