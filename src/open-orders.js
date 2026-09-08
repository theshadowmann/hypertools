/** Tab copy: always include the live count, including zero. */
export function openOrdersTabLabel(count) {
  const n = Number(count);
  const k = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return "Open Orders (" + k + ")";
}

export function setOpenOrdersTabLabel(btn, count) {
  if (!btn) return;
  btn.textContent = openOrdersTabLabel(count);
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
