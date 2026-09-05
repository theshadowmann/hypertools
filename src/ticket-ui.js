export const PERP_ONLY_IDS = ["lev-row", "sum-liq-row", "sum-margin-row"];
export const OUTCOME_ONLY_IDS = ["outcome-legs", "outcome-otype", "outcome-tif-wrap", "sum-payout-row"];
export const OUTCOME_HIDE_IDS = ["type-row", "ticket-chk-row", "ticket-pos-wrap"];

function kindOf(cashOrKind) {
  if (cashOrKind === "outcome" || cashOrKind === "spot" || cashOrKind === "perp") return cashOrKind;
  return cashOrKind ? "spot" : "perp";
}

/**
 * Spot ticket: Buy/Sell filled tabs, no leverage / Isolated-Cross / liq / margin / slippage.
 * Outcome ticket: Buy/Sell word tabs, Yes/No odds, Limit dropdown, TIF, payout. No lev/liq.
 * Perp ticket keeps Long/Short, Nx, Isolated/Cross, liq, margin, slippage.
 */
export function applyTicketKind(doc, cashOrKind) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d) return;
  const kind = kindOf(cashOrKind);
  const cash = kind === "spot" || kind === "outcome";
  const outcome = kind === "outcome";
  PERP_ONLY_IDS.forEach((id) => {
    d.getElementById(id)?.classList.toggle("hidden", cash);
  });
  d.getElementById("sum-slip-row")?.classList.toggle("hidden", cash);
  d.getElementById("market-chip-lev")?.classList.toggle("hidden", cash);
  OUTCOME_ONLY_IDS.forEach((id) => {
    d.getElementById(id)?.classList.toggle("hidden", !outcome);
  });
  OUTCOME_HIDE_IDS.forEach((id) => {
    const el = id === "type-row" ? d.querySelector(".type-row") : d.getElementById(id);
    el?.classList.toggle("hidden", outcome);
  });
  const tabs = d.querySelector(".ls-tabs");
  tabs?.classList.toggle("spot-sides", kind === "spot");
  tabs?.classList.toggle("outcome-sides", outcome);
  const buy = d.getElementById("side-buy");
  const sell = d.getElementById("side-sell");
  if (buy) buy.textContent = cash ? "Buy" : "Buy / Long";
  if (sell) sell.textContent = cash ? "Sell" : "Sell / Short";
  const priceK = d.getElementById("ticket-price-k");
  if (priceK) priceK.textContent = outcome ? "Price (USDC)" : "Price";
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
