import "./style.css";
import { wipeAgents } from "./agent-store.js";
import { ADDR_RE, loadAccount, loadMarkets } from "./api.js";
import { renderDashboard } from "./dashboard.js";
import { clear, h } from "./dom.js";
import { truncAddr } from "./format.js";
import { createHlWs } from "./ws.js";
import {
  attachWalletListeners,
  createWalletDiscovery,
  labelInjected,
  requestAccounts,
  walletTargets,
} from "./wallet.js";
import { guardProvider } from "./wallet-guard.js";

const state = {
  address: null,
  source: null,
  provider: null,
  data: null,
  loading: false,
  error: null,
  view: "portfolio",
};

const el = {
  landing: document.getElementById("landing"),
  dashboard: document.getElementById("dashboard"),
  trade: document.getElementById("trade"),
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
  navPortfolio: document.getElementById("nav-portfolio"),
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
  connectFromNav: () => connectFromNav(),
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
  return "portfolio";
}

function setView(view, push) {
  state.view = view === "trade" ? "trade" : "portfolio";
  if (push) {
    const url = state.view === "trade" ? "/trade" : "/portfolio";
    if (window.location.pathname !== url) {
      history.pushState({ view: state.view }, "", url);
    }
  }
  renderChrome();
  if (state.view === "trade") {
    getTrade().then((t) => t.show());
  }
}

function safeDataImage(src) {
  if (typeof src !== "string") return null;
  if (src.indexOf("data:image/") !== 0) return null;
  if (src.length > 24_000) return null;
  return src;
}

function connectButton(label, onClick, iconSrc) {
  const icon = iconSrc
    ? h("img", { src: iconSrc, alt: "", class: "h-5 w-5 rounded-sm" })
    : null;
  return h(
    "button",
    {
      type: "button",
      class:
        "wallet-connect-btn inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-accent-dim",
      onClick,
    },
    icon,
    "Connect " + label + " to trade"
  );
}

function renderWalletButtons() {
  const list = discoveredList;
  clear(el.walletButtons);
  if (list.length) {
    list.forEach((entry) => {
      const name = entry.info.name || "Wallet";
      el.walletButtons.appendChild(
        connectButton(name, () => connectWallet(entry.provider), safeDataImage(entry.info.icon))
      );
    });
    el.noWallet.classList.add("hidden");
  } else if (window.ethereum) {
    const label = labelInjected(window.ethereum);
    el.walletButtons.appendChild(connectButton(label, () => connectWallet(window.ethereum)));
    el.noWallet.classList.add("hidden");
  } else {
    el.noWallet.classList.remove("hidden");
  }
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
  if (state.view === "portfolio") {
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
      ". If this is CORS, your browser blocked the public API; we will not fake portfolio data.";
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
  if (state.address && state.address.toLowerCase() !== normalized.toLowerCase()) {
    wipeAgents();
  }
  state.address = normalized;
  state.source = source;
  refreshAccount(normalized);
  if (tradeView) tradeView.onAccount();
}

function disconnect() {
  wipeAgents();
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
  if (state.view === "portfolio") window.scrollTo({ top: 0, behavior: "smooth" });
}

async function connectWallet(provider) {
  try {
    const guarded = guardProvider(provider);
    const addr = await requestAccounts(guarded);
    state.provider = guarded;
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
  const footer = document.querySelector("footer");
  if (footer) footer.classList.toggle("hidden", onTrade);
  if (el.navPortfolio) {
    el.navPortfolio.setAttribute("aria-current", onTrade ? "false" : "page");
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
  clear(el.navWalletMenu);
}

function showNavWalletMenu(targets) {
  if (!el.navWalletMenu) return;
  clear(el.navWalletMenu);
  targets.forEach((t) => {
    el.navWalletMenu.appendChild(
      h(
        "button",
        {
          type: "button",
          class:
            "block w-full px-3 py-2 text-left text-sm text-mist-200 transition hover:bg-white/5 hover:text-white",
          role: "menuitem",
          onClick: (ev) => {
            ev.stopPropagation();
            hideNavWalletMenu();
            connectWallet(t.provider);
          },
        },
        "Connect " + t.name + " to trade"
      )
    );
  });
  el.navWalletMenu.classList.remove("hidden");
  el.navWalletMenu.removeAttribute("hidden");
}

function connectFromNav() {
  const targets = walletTargets(discoveredList);
  if (!targets.length) {
    if (state.view !== "portfolio") setView("portfolio", true);
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
  setView("trade", true);
});

el.navPortfolio.addEventListener("click", (ev) => {
  ev.preventDefault();
  setView("portfolio", true);
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
