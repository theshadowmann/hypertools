import { walletTargets } from "./wallet.js";
import {
  CHECK_POPUP_MSG,
  LOOKING_MSG,
  NO_WALLET_MSG,
  OPENING_WALLET_MSG,
  bindConnectCapture,
  closeConnectModal,
  markConnectButtonsOpening,
  openConnectModal,
  paintConnectInstall,
  paintConnectLooking,
  paintConnectTargets,
  setConnectUiStatus,
  ticketWantsConnect,
} from "./connect-modal.js";

export {
  CHECK_POPUP_MSG,
  LOOKING_MSG,
  NO_WALLET_MSG,
  OPENING_WALLET_MSG,
  bindConnectCapture,
  closeConnectModal,
  markConnectButtonsOpening,
  openConnectModal,
  paintConnectInstall,
  paintConnectLooking,
  paintConnectTargets,
  setConnectUiStatus,
  ticketWantsConnect,
};

export const DISCOVER_MS = 300;

export function showConnectStatus(msg, kind) {
  setConnectUiStatus(msg, kind);
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

export function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Opens the full-screen modal before wallet lookup. Never auto-calls
 * eth_requestAccounts on the first click.
 */
let connectInFlight = false;

export async function runConnectFromNav(opts) {
  const o = opts || {};
  if (connectInFlight) return { kind: "busy" };
  connectInFlight = true;
  try {
    markConnectButtonsOpening();
    setConnectUiStatus(OPENING_WALLET_MSG);
    if (typeof o.onOpening === "function") o.onOpening(OPENING_WALLET_MSG);
    openConnectModal();
    paintConnectLooking();
    if (typeof o.refreshDiscovery === "function") o.refreshDiscovery();
    else if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      try {
        window.dispatchEvent(new Event("eip6963:requestProvider"));
      } catch {
        /* ignore */
      }
    }
    const wait = o.discoverMs == null ? DISCOVER_MS : Number(o.discoverMs);
    if (wait > 0) await waitMs(wait);
    const list = typeof o.getDiscovered === "function" ? o.getDiscovered() : o.discoveredList;
    const targets = resolveWalletTargets(list, o.ethereum);
    if (!targets.length) {
      paintConnectInstall();
      if (typeof o.onNoWallet === "function") o.onNoWallet(NO_WALLET_MSG);
      return { kind: "nowallet" };
    }
    paintConnectTargets(targets, (t) => {
      const hint = CHECK_POPUP_MSG;
      setConnectUiStatus(hint);
      if (typeof o.onPick === "function") o.onPick(t);
      else if (typeof o.connectWallet === "function") o.connectWallet(t.provider);
    });
    return { kind: "modal", targets };
  } catch (err) {
    const msg = (err && err.message) || String(err);
    setConnectUiStatus(msg, "err");
    if (typeof o.onError === "function") o.onError(msg);
    return { kind: "error", message: msg };
  } finally {
    connectInFlight = false;
  }
}

export function resetConnectInFlightForTests() {
  connectInFlight = false;
}
