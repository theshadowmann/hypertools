import { bindConnectClick } from "./nav-connect.js";

/**
 * Page listeners. Landing / Portfolio nodes are optional so a missing
 * #paste-form cannot skip binding #btn-nav-connect.
 */
export function bindAppListeners({
  el,
  onPaste,
  onRefresh,
  onDisconnect,
  onWordmark,
  onPortfolio,
  onTrade,
  onOutcome,
  connectFromNav,
  hideNavWalletMenu,
}) {
  const navBtn =
    (el && el.navConnect) ||
    (typeof document !== "undefined" ? document.getElementById("btn-nav-connect") : null);
  if (navBtn) {
    bindConnectClick(navBtn, () => {
      connectFromNav();
    });
  }

  el?.pasteForm?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    onPaste(ev);
  });

  const refresh = document.getElementById("btn-refresh");
  if (refresh) refresh.addEventListener("click", onRefresh);

  const disconnectBtn = document.getElementById("btn-disconnect");
  if (disconnectBtn) disconnectBtn.addEventListener("click", onDisconnect);

  const wordmark = document.getElementById("wordmark");
  if (wordmark) {
    wordmark.addEventListener("click", (ev) => {
      ev.preventDefault();
      onWordmark(ev);
    });
  }

  if (el && el.navPortfolio) {
    el.navPortfolio.addEventListener("click", (ev) => {
      ev.preventDefault();
      onPortfolio(ev);
    });
  }
  if (el && el.navTrade) {
    el.navTrade.addEventListener("click", (ev) => {
      ev.preventDefault();
      onTrade(ev);
    });
  }
  if (el && el.navOutcome) {
    el.navOutcome.addEventListener("click", (ev) => {
      ev.preventDefault();
      onOutcome(ev);
    });
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t && typeof t.closest === "function" && t.closest("#btn-nav-connect, #nav-wallet-menu, #ticket-submit")) {
      return;
    }
    hideNavWalletMenu();
  });
}
