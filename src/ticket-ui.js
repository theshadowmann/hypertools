export const PERP_ONLY_IDS = ["lev-row", "sum-liq-row", "sum-margin-row"];

/**
 * Spot ticket: Buy/Sell only, no leverage / Isolated-Cross / liq / margin / slippage.
 * Perp ticket keeps Long/Short, Nx, Isolated/Cross, liq, margin, slippage.
 */
export function applyTicketKind(doc, cash) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d) return;
  const on = !!cash;
  PERP_ONLY_IDS.forEach((id) => {
    d.getElementById(id)?.classList.toggle("hidden", on);
  });
  d.getElementById("sum-slip-row")?.classList.toggle("hidden", on);
  d.getElementById("market-chip-lev")?.classList.toggle("hidden", on);
  d.querySelector(".ls-tabs")?.classList.toggle("spot-sides", on);
  const buy = d.getElementById("side-buy");
  const sell = d.getElementById("side-sell");
  if (buy) buy.textContent = on ? "Buy" : "Buy / Long";
  if (sell) sell.textContent = on ? "Sell" : "Sell / Short";
}

export function bindCoinIcon(img) {
  if (!img || img.dataset.iconBound === "1") return;
  img.dataset.iconBound = "1";
  img.addEventListener("error", () => {
    img.hidden = true;
    img.removeAttribute("src");
  });
  img.addEventListener("load", () => {
    img.hidden = false;
  });
}

export function setCoinIcon(img, url) {
  if (!img) return;
  bindCoinIcon(img);
  img.hidden = true;
  img.removeAttribute("src");
  if (url) img.setAttribute("src", url);
}
