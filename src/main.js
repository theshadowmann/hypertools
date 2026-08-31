import "./style.css";
import { ADDR_RE, loadAccount, loadMarkets } from "./api.js";
import { renderDashboard } from "./dashboard.js";
import { truncAddr } from "./format.js";
import { createHlWs } from "./ws.js";
import {
  attachWalletListeners,
  createWalletDiscovery,
  labelInjected,
  requestAccounts,
  walletTargets,
} from "./wallet.js";
import { escapeHtml } from "./format.js";

const state = {
  address: null,
  source: null,
  provider: null,
  data: null,
  loading: false,
  error: null,
  view: "account",
};

const el = {
  landing: document.getElementById("landing"),
  dashboard: document.getElementById("dashboard"),
  trade: document.getElementById("trade"),
  liveChip: document.getElementById("live-chip"),
  navDisc: document.getElementById("nav-disconnected"),
  navConn: document.getElementById("nav-connected"),
  navAddress: document.getElementById("nav-address"),
  navConnect: document.getElementById("btn-nav-connect"),
  navWalletMenu: document.getElementById("nav-wallet-menu"),
  walletButtons: document.getElementById("wallet-buttons"),
  noWallet: document.getElementById("no-wallet"),
  pasteForm: document.getElementById("paste-form"),
  pasteInput: document.getElementById("paste-address"),
  pasteError: document.getElementById("paste-error"),
  errorBanner: document.getElementById("error-banner"),
  loading: document.getElementById("loading"),
  dashContent: document.getElementById("dash-content"),
  dashSubtitle: document.getElementById("dash-subtitle"),
  dashUpdated: document.getElementById("dash-updated"),
  overview: document.getElementById("overview-cards"),
  perpsRoot: document.getElementById("perps-root"),
  perpsCount: document.getElementById("perps-count"),
  spotRoot: document.getElementById("spot-root"),
  spotCount: document.getElementById("spot-count"),
  stakingRoot: document.getElementById("staking-root"),
  navAccount: document.getElementById("nav-account"),
  navTrade: document.getElementById("nav-trade"),
};

const socket = createHlWs();
let walletUnsub = null;
let discoveredList = [];
let tradeView = null;

const app = {
  state,
  el,
  socket,
  loadMarkets,
  reloadAccount: () => {
    if (state.address) return refreshAccount(state.address);
  },
};

async function getTrade() {
  if (!tradeView) {
    const mod = await import("./trade.js");
    tradeView = mod.createTradeView(app);
  }
  return tradeView;
}

function viewFromLocation() {
  const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/trade" || window.location.hash === "#trade" || window.location.hash === "#/trade") {
    return "trade";
  }
  return "account";
}

function setView(view, push) {
  state.view = view === "trade" ? "trade" : "account";
  if (push) {
    const url = state.view === "trade" ? "/trade" : "/";
    if (window.location.pathname !== url) {
      history.pushState({ view: state.view }, "", url);
    }
  }
  renderChrome();
  if (state.view === "trade") {
    getTrade().then((t) => t.show());
  }
}

function renderWalletButtons() {
  const list = discoveredList;
  let html = "";
  if (list.length) {
    list.forEach((entry) => {
      const name = escapeHtml(entry.info.name || "Wallet");
      const uuid = escapeHtml(entry.info.uuid);
      const icon = entry.info.icon
        ? '<img src="' + escapeHtml(entry.info.icon) + '" alt="" class="h-5 w-5 rounded-sm" />'
        : "";
      html +=
        '<button type="button" data-uuid="' +
        uuid +
        '" class="wallet-connect-btn inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-accent-dim">' +
        icon +
        "Connect " +
        name +
        " to trade" +
        "</button>";
    });
    el.noWallet.classList.add("hidden");
  } else if (window.ethereum) {
    const label = labelInjected(window.ethereum);
    html =
      '<button type="button" data-fallback="1" class="wallet-connect-btn inline-flex h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-accent-dim">Connect ' +
      escapeHtml(label) +
      " to trade</button>";
    el.noWallet.classList.add("hidden");
  } else {
    el.noWallet.classList.remove("hidden");
  }
  el.walletButtons.innerHTML = html;
  el.walletButtons.querySelectorAll(".wallet-connect-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uuid = btn.getAttribute("data-uuid");
      let provider = null;
      const found = list.find((e) => e.info.uuid === uuid);
      if (found) provider = found.provider;
      else if (btn.getAttribute("data-fallback")) provider = window.ethereum;
      if (!provider) return;
      connectWallet(provider);
    });
  });
}

function showPasteError(msg) {
  el.pasteError.textContent = msg;
  el.pasteError.classList.remove("hidden");
}

function clearPasteError() {
  el.pasteError.textContent = "";
  el.pasteError.classList.add("hidden");
}

async function refreshAccount(address) {
  state.loading = true;
  state.error = null;
  renderChrome();
  if (state.view === "account") {
    el.loading.classList.remove("hidden");
    el.dashContent.classList.add("hidden");
    el.errorBanner.classList.add("hidden");
  }
  try {
    const { data, errors } = await loadAccount(address);
    state.data = data;
    if (errors.length) {
      state.error =
        "Could not load some Hyperliquid data. " +
        errors.join(" · ") +
        " If this is a browser CORS block, the request never reached Hyperliquid — we do not invent substitute numbers.";
    } else {
      state.error = null;
    }
  } catch (err) {
    state.data = null;
    state.error =
      "Hyperliquid Info API request failed: " +
      ((err && err.message) || String(err)) +
      ". If this is CORS, your browser blocked the public API; we will not fake account data.";
  }
  state.loading = false;
  renderChrome();
  renderDashboard(el, state);
  if (tradeView) tradeView.onData();
}

function setAddress(address, source) {
  const normalized = String(address || "").trim();
  if (!ADDR_RE.test(normalized)) {
    showPasteError("Enter a valid 0x address (42 hex characters).");
    return;
  }
  clearPasteError();
  state.address = normalized;
  state.source = source;
  refreshAccount(normalized);
  if (tradeView) tradeView.onAccount();
}

function disconnect() {
  if (typeof walletUnsub === "function") walletUnsub();
  walletUnsub = null;
  state.address = null;
  state.source = null;
  state.provider = null;
  state.data = null;
  state.error = null;
  state.loading = false;
  renderChrome();
  if (tradeView) tradeView.onAccount();
  if (state.view === "account") window.scrollTo({ top: 0, behavior: "smooth" });
}

async function connectWallet(provider) {
  try {
    const addr = await requestAccounts(provider);
    state.provider = provider;
    if (typeof walletUnsub === "function") walletUnsub();
    walletUnsub = attachWalletListeners(provider, {
      onAccounts: (next) => {
        if (next && next.toLowerCase() !== (state.address || "").toLowerCase()) {
          setAddress(next, "wallet");
        }
      },
      onDisconnect: disconnect,
    });
    setAddress(addr, "wallet");
  } catch (err) {
    showPasteError((err && err.message) || "Wallet connection was rejected.");
  }
}

function renderChrome() {
  const connected = !!state.address;
  const onTrade = state.view === "trade";
  el.landing.classList.toggle("hidden", connected || onTrade);
  el.dashboard.classList.toggle("hidden", !connected || onTrade);
  el.trade.classList.toggle("hidden", !onTrade);
  el.navDisc.classList.toggle("hidden", connected);
  el.navConn.classList.toggle("hidden", !connected);
  el.navConn.classList.toggle("flex", connected);
  el.liveChip.classList.toggle("hidden", !connected && !onTrade);
  el.liveChip.classList.toggle("inline-flex", connected || onTrade);
  const footer = document.querySelector("footer");
  if (footer) footer.classList.toggle("hidden", onTrade);
  if (el.navAccount) {
    el.navAccount.setAttribute("aria-current", onTrade ? "false" : "page");
  }
  if (el.navTrade) {
    el.navTrade.setAttribute("aria-current", onTrade ? "page" : "false");
  }
  if (connected) {
    el.navAddress.textContent = truncAddr(state.address);
    el.navAddress.title = state.address;
    const via = state.source === "wallet" ? "connected wallet" : "pasted address";
    el.dashSubtitle.textContent = state.address + "  ·  " + via;
  }
}

function hideNavWalletMenu() {
  if (!el.navWalletMenu) return;
  el.navWalletMenu.classList.add("hidden");
  el.navWalletMenu.setAttribute("hidden", "");
  el.navWalletMenu.innerHTML = "";
}

function showNavWalletMenu(targets) {
  if (!el.navWalletMenu) return;
  el.navWalletMenu.innerHTML = targets
    .map((t, i) => {
      return (
        '<button type="button" data-i="' +
        i +
        '" class="block w-full px-3 py-2 text-left text-sm text-mist-200 transition hover:bg-white/5 hover:text-white" role="menuitem">' +
        "Connect " +
        escapeHtml(t.name) +
        " to trade" +
        "</button>"
      );
    })
    .join("");
  el.navWalletMenu.classList.remove("hidden");
  el.navWalletMenu.removeAttribute("hidden");
  el.navWalletMenu.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const i = Number(btn.getAttribute("data-i"));
      hideNavWalletMenu();
      if (targets[i]) connectWallet(targets[i].provider);
    });
  });
}

function connectFromNav() {
  const targets = walletTargets(discoveredList);
  if (!targets.length) {
    if (state.view !== "account") setView("account", true);
    const section = document.getElementById("connect");
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (targets.length === 1) {
    hideNavWalletMenu();
    connectWallet(targets[0].provider);
    return;
  }
  if (el.navWalletMenu && !el.navWalletMenu.classList.contains("hidden")) {
    hideNavWalletMenu();
    return;
  }
  showNavWalletMenu(targets);
}

el.pasteForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  setAddress(el.pasteInput.value, "paste");
});

document.getElementById("btn-refresh").addEventListener("click", () => {
  if (state.address) refreshAccount(state.address);
});

document.getElementById("btn-disconnect").addEventListener("click", disconnect);

document.getElementById("wordmark").addEventListener("click", (ev) => {
  ev.preventDefault();
  setView("account", true);
  if (!state.address) window.scrollTo({ top: 0, behavior: "smooth" });
});

el.navAccount.addEventListener("click", (ev) => {
  ev.preventDefault();
  setView("account", true);
});
el.navTrade.addEventListener("click", (ev) => {
  ev.preventDefault();
  setView("trade", true);
});

if (el.navConnect) {
  el.navConnect.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    connectFromNav();
  });
}

document.addEventListener("click", hideNavWalletMenu);

window.addEventListener("popstate", () => {
  setView(viewFromLocation(), false);
});

createWalletDiscovery((list) => {
  discoveredList = list;
  renderWalletButtons();
});
renderWalletButtons();

state.view = viewFromLocation();
renderChrome();
if (state.view === "trade") getTrade().then((t) => t.show());
