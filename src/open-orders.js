/** HL-style hist tab label: omit (n) when count is 0. */
export function histTabLabel(base, count) {
  const n = Number(count);
  const k = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return k > 0 ? base + " (" + k + ")" : String(base);
}

export function setHistTabLabel(btn, base, count) {
  if (!btn) return;
  btn.textContent = histTabLabel(base, count);
}

export function openOrdersTabLabel(count) {
  return histTabLabel("Open Orders", count);
}

export function setOpenOrdersTabLabel(btn, count) {
  setHistTabLabel(btn, "Open Orders", count);
}

/**
 * Shape one cancelOrders call: `{asset, oid}` per open order.
 * Drops rows without a numeric oid or resolvable asset.
 */
export function cancelAllCancels(orders, assetOf) {
  const out = [];
  (orders || []).forEach((o) => {
    if (!o) return;
    const oid = Number(o.oid);
    if (!Number.isFinite(oid) || oid <= 0) return;
    const raw = typeof assetOf === "function" ? assetOf(o) : o.asset;
    const asset = Number(raw);
    if (!Number.isFinite(asset)) return;
    out.push({ asset, oid });
  });
  return out;
}
