import { walletTargets } from "./wallet.js";

export const NO_WALLET_MSG = "Install MetaMask or Rabby";
export const OPENING_WALLET_MSG = "Opening wallet…";
export const CHECK_POPUP_MSG = "Check the wallet popup";

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

/** Create `#nav-wallet-menu` if missing and keep it on `document.body` (fixed, above the trade shell). */
export function ensureWalletMenu() {
  if (typeof document === "undefined") return null;
  let menu = document.getElementById("nav-wallet-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "nav-wallet-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
  }
  menu.classList.add("nav-wallet-menu");
  if (document.body && menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
  return menu;
}

export function positionWalletMenu(menu, anchor) {
  if (!menu) return;
  const btn = anchor || (typeof document !== "undefined" ? document.getElementById("btn-nav-connect") : null);
  menu.style.position = "fixed";
  menu.style.zIndex = "200";
  if (!btn || typeof btn.getBoundingClientRect !== "function") {
    menu.style.top = "48px";
    menu.style.right = "12px";
    menu.style.left = "auto";
    return;
  }
  const r = btn.getBoundingClientRect();
  menu.style.top = Math.round(r.bottom + 8) + "px";
  menu.style.right = Math.round((typeof window !== "undefined" ? window.innerWidth : 0) - r.right) + "px";
  menu.style.left = "auto";
}

export function hideWalletMenu(menu) {
  const node = menu || (typeof document !== "undefined" ? document.getElementById("nav-wallet-menu") : null);
  if (!node) return;
  node.classList.add("hidden");
  node.setAttribute("hidden", "");
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function isWalletMenuOpen(menu) {
  const node = menu || (typeof document !== "undefined" ? document.getElementById("nav-wallet-menu") : null);
  if (!node) return false;
  return !node.classList.contains("hidden") && !node.hasAttribute("hidden");
}

export function fillWalletMenu(menu, targets, onPick) {
  const node = menu || ensureWalletMenu();
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  (targets || []).forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-wallet-item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = "Connect " + t.name + " to trade";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hideWalletMenu(node);
      if (typeof onPick === "function") onPick(t);
    });
    node.appendChild(btn);
  });
  return node;
}

/** Bind bubble listener and `onclick` fallback. Same-click double-fire is ignored. */
export function bindConnectClick(node, handler) {
  if (!node || typeof handler !== "function") return;
  const fire = (ev) => {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    if (node._htConnectLock) return;
    node._htConnectLock = true;
    try {
      handler(ev);
    } finally {
      const unlock = () => {
        node._htConnectLock = false;
      };
      if (typeof queueMicrotask === "function") queueMicrotask(unlock);
      else setTimeout(unlock, 0);
    }
  };
  node.addEventListener("click", fire);
  node.onclick = fire;
}

/**
 * Shared header + ticket connect path. Never navigates to Portfolio.
 * Always writes ticket-status so a hung wallet prompt is not a blank click.
 */
export function runConnectFromNav(opts) {
  const o = opts || {};
  showConnectStatus(OPENING_WALLET_MSG);
  if (typeof o.onOpening === "function") o.onOpening(OPENING_WALLET_MSG);
  if (typeof o.refreshDiscovery === "function") o.refreshDiscovery();
  else if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch {
      /* ignore */
    }
  }
  const targets = resolveWalletTargets(o.discoveredList, o.ethereum);
  if (!targets.length) {
    const msg = o.noWalletMessage || NO_WALLET_MSG;
    if (typeof o.onNoWallet === "function") o.onNoWallet(msg);
    else showConnectStatus(msg, "err");
    return { kind: "nowallet" };
  }
  if (targets.length === 1) {
    if (typeof o.hideMenu === "function") o.hideMenu();
    showConnectStatus(CHECK_POPUP_MSG);
    o.connectWallet(targets[0].provider);
    return { kind: "connect", provider: targets[0].provider };
  }
  if (typeof o.showMenu === "function") o.showMenu(targets);
  return { kind: "menu", targets };
}
