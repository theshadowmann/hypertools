import "./style.css";
import { wipeAgents } from "./agent-store.js";
import { ADDR_RE, loadAccountBook, loadAccountCore, loadAccountSlow, loadMarkets, loadTradeExtras } from "./api.js";
import { renderDashboard } from "./dashboard.js";
import { clear, h } from "./dom.js";
import { truncAddr } from "./format.js";
import { createHlWs } from "./ws.js";
import {
  attachWalletListeners,
  createWalletDiscovery,
  labelInjected,
  requestAccounts,
} from "./wallet.js";
import { guardProvider } from "./wallet-guard.js";
import { deskUrl, viewFromLocation } from "./routes.js";
import { bindAppListeners } from "./app-bind.js";
import {
  CHECK_POPUP_MSG,
  OPENING_WALLET_MSG,
  bindConnectCapture,
  closeConnectModal,
  runConnectFromNav,
  showConnectStatus,
} from "./nav-connect.js";
import { bindOutcomeCloseApp } from "./outcome-close.js";
import { bindPerpCloseApp } from "./perp-close.js";

const state = {
  address: null,
  source: null,
  provider: null,
  data: null,
  extras: null,
  markets: [],
  loading: false,
  coreLoading: false,
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
  navPortfolio: document.getElementById("nav-portfolio"),
  navTrade: document.getElementById("nav-trade"),
  navOutcome: document.getElementById("nav-outcome"),
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
  navigate(view) {
    setView(view, true);
  },
  reloadAccount: () => {
    if (state.address) return refreshAccount(state.address);
  },
  connectFromNav: () => connectFromNav(),
};

bindOutcomeCloseApp(() => app);
bindPerpCloseApp(() => app);

async function getTrade() {
  if (!tradeView) {
    const mod = await import("./trade.js");
    tradeView = mod.createTradeView(app);
  }
  return tradeView;
}

function currentView() {
  return viewFromLocation(window.location.pathname, window.location.hash);
}

function hideAppViews() {
  if (el.landing) el.landing.classList.add("hidden");
  if (el.dashboard) el.dashboard.classList.add("hidden");
  if (el.trade) el.trade.classList.add("hidden");
  document.documentElement.classList.remove("desk");
  document.body.classList.remove("desk");
}

function setEmbedShell(on) {
  document.documentElement.classList.toggle("tv-embed-frame", on);
  const header = document.querySelector("body > header");
  const footer = document.querySelector("footer");
  if (header) header.classList.toggle("hidden", on);
  if (footer) footer.classList.toggle("hidden", on);
}

function setView(view, push) {
  if (view === "embed") {
    state.view = "embed";
    hideAppViews();
    setEmbedShell(true);
    return;
  }
  setEmbedShell(false);
  state.view = view === "trade" || view === "outcome" ? view : "portfolio";
  if (push) {
    const url = deskUrl(state.view);
    if (window.location.pathname !== url) {
      history.pushState({ view: state.view }, "", url);
    }
  }
  renderChrome();
  if (state.view === "trade" || state.view === "outcome") {
    getTrade().then((t) => t.show(state.view));
  } else {
    renderDashboard(el, state);
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
        "wallet-connect-btn inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-glow transition",
      onClick,
    },
    icon,
    "Connect " + label + " to trade"
  );
}

function renderWalletButtons() {
  if (!el.walletButtons || !el.noWallet) return;
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
  if (el.pasteError) {
    el.pasteError.textContent = msg;
    el.pasteError.classList.remove("hidden");
  }
  showConnectStatus(msg, "err");
}

function clearPasteError() {
  if (!el.pasteError) return;
  el.pasteError.textContent = "";
  el.pasteError.classList.add("hidden");
}

async function refreshAccount(address) {
  const gen = (refreshAccount._gen = (refreshAccount._gen || 0) + 1);
  state.loading = true;
  state.coreLoading = true;
  state.error = null;
  renderChrome();
  if (state.view === "portfolio") {
    if (el.loading) el.loading.classList.remove("hidden");
    if (el.errorBanner) el.errorBanner.classList.add("hidden");
  }
  if (tradeView) tradeView.onData();
  const emptyExtras = {
    historicalOrders: [],
    fundingHistory: [],
    twapHistory: [],
    twapFills: [],
    userFees: null,
  };
  const prev = state.data;
  const keepClearinghouse = (data) => {
    if (!prev || typeof prev !== "object") return data;
    let next = data;
    if (!next.perps && prev.perps) next = { ...next, perps: prev.perps };
    if (!next.spot && prev.spot) next = { ...next, spot: prev.spot };
    if (next.abstraction == null && prev.abstraction != null) {
      next = { ...next, abstraction: prev.abstraction };
    }
    return next;
  };
  const paint = () => {
    if (gen !== refreshAccount._gen) return;
    renderChrome();
    renderDashboard(el, state);
    if (tradeView) tradeView.onData();
  };
  const mergeErrors = (errors) => {
    if (!errors || !errors.length) return;
    state.error =
      "Could not load some Hyperliquid data. " +
      errors.join(" · ") +
      " If this is a browser CORS block, the request never reached Hyperliquid — we do not invent substitute numbers.";
  };

  try {
    // 1) Core balances/positions first — paint immediately.
    let core = await loadAccountCore(address);
    if (gen !== refreshAccount._gen) return;
    let data = keepClearinghouse(core.data);
    let errors = core.errors.slice();
    if ((!data.perps || !data.spot) && errors.some((e) => /429|Too Many|HTTP 429/i.test(e))) {
      await new Promise((r) => setTimeout(r, 600));
      if (gen !== refreshAccount._gen) return;
      core = await loadAccountCore(address);
      if (gen !== refreshAccount._gen) return;
      data = keepClearinghouse({ ...data, ...core.data });
      errors = core.errors.slice();
    }
    // Preserve book/slow fields from prev while background stages catch up.
    if (prev && typeof prev === "object") {
      data = {
        ...prev,
        ...data,
        openOrders: Array.isArray(prev.openOrders) ? prev.openOrders : data.openOrders,
        fills: Array.isArray(prev.fills) ? prev.fills : data.fills,
        mids: prev.mids && typeof prev.mids === "object" ? prev.mids : data.mids,
        portfolio: prev.portfolio != null ? prev.portfolio : data.portfolio,
        userFees: prev.userFees != null ? prev.userFees : data.userFees,
        staking: prev.staking != null ? prev.staking : data.staking,
        delegations: prev.delegations != null ? prev.delegations : data.delegations,
        subAccounts: Array.isArray(prev.subAccounts) ? prev.subAccounts : data.subAccounts,
      };
      data = keepClearinghouse(data);
    }
    state.data = data;
    state.coreLoading = false;
    state.loading = false;
    if (errors.length) mergeErrors(errors);
    else state.error = null;
    paint();

    // 2) Orders/fills/mids in background (never block balances).
    loadAccountBook(address)
      .then((book) => {
        if (gen !== refreshAccount._gen || !state.data) return;
        state.data = { ...state.data, ...book.data };
        if (book.errors.length) mergeErrors(book.errors);
        paint();
      })
      .catch(() => {});

    // 3) Markets only if missing — after core painted.
    if (!(state.markets && state.markets.length)) {
      loadMarkets()
        .then((mkts) => {
          if (gen !== refreshAccount._gen || !mkts || !mkts.length) return;
          state.markets = mkts;
          paint();
        })
        .catch(() => {});
    }

    // 4) Portfolio chrome + trade history extras — delayed so they cannot starve core.
    setTimeout(() => {
      if (gen !== refreshAccount._gen) return;
      loadAccountSlow(address)
        .then((slow) => {
          if (gen !== refreshAccount._gen || !state.data) return;
          state.data = { ...state.data, ...slow.data };
          if (slow.errors.length) mergeErrors(slow.errors);
          paint();
        })
        .catch(() => {});
      loadTradeExtras(address)
        .catch(() => emptyExtras)
        .then((extra) => {
          if (gen !== refreshAccount._gen) return;
          state.extras = extra || emptyExtras;
          paint();
        });
    }, 400);
  } catch (err) {
    if (gen !== refreshAccount._gen) return;
    if (!state.data) state.data = null;
    state.extras = state.extras || emptyExtras;
    state.error =
      "Hyperliquid Info API request failed: " +
      ((err && err.message) || String(err)) +
      ". If this is CORS, your browser blocked the public API; we will not fake portfolio data.";
    state.coreLoading = false;
    state.loading = false;
    paint();
  }
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
  state.extras = null;
  state.error = null;
  state.loading = false;
  state.coreLoading = false;
  renderChrome();
  if (tradeView) tradeView.onAccount();
  if (state.view === "portfolio") {
    renderDashboard(el, state);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
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
    closeConnectModal();
  } catch (err) {
    const msg = (err && err.message) || "Wallet connection was rejected.";
    showPasteError(msg);
    if (tradeView && typeof tradeView.setStatus === "function") {
      tradeView.setStatus(msg, "err");
    }
    showConnectStatus(msg, "err");
  }
}

function renderChrome() {
  const connected = !!state.address;
  const onDesk = state.view === "trade" || state.view === "outcome";
  const onPort = state.view === "portfolio";
  document.documentElement.classList.toggle("desk", onDesk);
  document.body.classList.toggle("desk", onDesk);
  el.landing?.classList.toggle("hidden", connected || onDesk || onPort);
  el.dashboard?.classList.toggle("hidden", !onPort);
  el.trade?.classList.toggle("hidden", !onDesk);
  el.navDisc?.classList.toggle("hidden", connected);
  el.navConn?.classList.toggle("hidden", !connected);
  el.navConn?.classList.toggle("flex", connected);
  const footer = document.querySelector("footer");
  if (footer) footer.classList.toggle("hidden", onDesk);
  if (el.navPortfolio) {
    el.navPortfolio.setAttribute("aria-current", state.view === "portfolio" ? "page" : "false");
  }
  if (el.navTrade) {
    el.navTrade.setAttribute("aria-current", state.view === "trade" ? "page" : "false");
  }
  if (el.navOutcome) {
    el.navOutcome.setAttribute("aria-current", state.view === "outcome" ? "page" : "false");
  }
  if (connected && el.navAddress) {
    el.navAddress.textContent = truncAddr(state.address);
    el.navAddress.title = state.address;
    const via = state.source === "wallet" ? "connected wallet" : "pasted address";
    if (el.dashSubtitle) el.dashSubtitle.textContent = state.address + "  ·  " + via;
  } else if (el.dashSubtitle) {
    el.dashSubtitle.textContent = "";
  }
}

function hideNavWalletMenu() {
  /* dropdown retired; modal is the picker */
}

function connectFromNav() {
  try {
    el.navConnect = el.navConnect || document.getElementById("btn-nav-connect");
    return runConnectFromNav({
      getDiscovered: () => discoveredList,
      discoveredList,
      ethereum: typeof window !== "undefined" ? window.ethereum : null,
      connectWallet: (provider) => {
        showConnectStatus(CHECK_POPUP_MSG);
        if (tradeView && typeof tradeView.setStatus === "function") {
          tradeView.setStatus(CHECK_POPUP_MSG);
        }
        return connectWallet(provider);
      },
      refreshDiscovery: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("eip6963:requestProvider"));
        }
      },
      onOpening: (msg) => {
        if (tradeView && typeof tradeView.setStatus === "function") tradeView.setStatus(msg || OPENING_WALLET_MSG);
      },
      onNoWallet: (msg) => {
        showConnectStatus(msg, "err");
        if (tradeView && typeof tradeView.setStatus === "function") tradeView.setStatus(msg, "err");
      },
      onError: (msg) => {
        showConnectStatus(msg, "err");
        if (tradeView && typeof tradeView.setStatus === "function") tradeView.setStatus(msg, "err");
      },
    });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    showConnectStatus(msg, "err");
    if (tradeView && typeof tradeView.setStatus === "function") tradeView.setStatus(msg, "err");
    return { kind: "error", message: msg };
  }
}

bindConnectCapture(connectFromNav);

bindAppListeners({
  el,
  onPaste: () => setAddress(el.pasteInput && el.pasteInput.value, "paste"),
  onRefresh: () => {
    if (state.address) refreshAccount(state.address);
  },
  onDisconnect: disconnect,
  onWordmark: () => setView("trade", true),
  onPortfolio: () => setView("portfolio", true),
  onTrade: () => setView("trade", true),
  onOutcome: () => setView("outcome", true),
  connectFromNav,
  hideNavWalletMenu,
});

window.addEventListener("popstate", () => {
  setView(currentView(), false);
});

createWalletDiscovery((list) => {
  discoveredList = list;
  renderWalletButtons();
});
renderWalletButtons();

state.view = currentView();
if (state.view === "embed") {
  hideAppViews();
  setEmbedShell(true);
} else {
  renderChrome();
  if (state.view === "trade" || state.view === "outcome") getTrade().then((t) => t.show(state.view));
  else renderDashboard(el, state);
}
