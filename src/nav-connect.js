import { walletTargets } from "./wallet.js";

export const NO_WALLET_MSG = "Install MetaMask or Rabby";

export function showConnectStatus(msg, kind) {
  const el = document.getElementById("ticket-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("err", "ok");
  if (kind === "err") el.classList.add("err");
  if (kind === "ok") el.classList.add("ok");
}

export function resolveWalletTargets(discoveredList, ethereum) {
  const list = discoveredList || [];
  const picked = walletTargets(list);
  if (picked.length) return picked;
  if (ethereum || (typeof window !== "undefined" && window.ethereum)) {
    return walletTargets([]);
  }
  return [];
}

/**
 * Shared header + ticket connect path. Never navigates to Portfolio.
 */
export function runConnectFromNav(opts) {
  const targets = resolveWalletTargets(opts.discoveredList, opts.ethereum);
  if (!targets.length) {
    const msg = opts.noWalletMessage || NO_WALLET_MSG;
    if (typeof opts.onNoWallet === "function") opts.onNoWallet(msg);
    else showConnectStatus(msg, "err");
    return { kind: "nowallet" };
  }
  if (targets.length === 1) {
    if (typeof opts.hideMenu === "function") opts.hideMenu();
    opts.connectWallet(targets[0].provider);
    return { kind: "connect", provider: targets[0].provider };
  }
  if (opts.menuOpen) {
    if (typeof opts.hideMenu === "function") opts.hideMenu();
    return { kind: "hide" };
  }
  if (typeof opts.showMenu === "function") opts.showMenu(targets);
  return { kind: "menu", targets };
}
