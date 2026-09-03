/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDER_ADDRESS, sealOrderPayload, assertCanTrade } from "./order-build.js";
import { bindAppListeners } from "./app-bind.js";
import {
  CHECK_POPUP_MSG,
  NO_WALLET_MSG,
  OPENING_WALLET_MSG,
  resetConnectInFlightForTests,
  runConnectFromNav,
} from "./nav-connect.js";
import { closeConnectModal, resetConnectCaptureForTests } from "./connect-modal.js";
import {
  createWalletDiscovery,
  walletKind,
  walletTargets,
} from "./wallet.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function mmEntry(request) {
  return {
    info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" },
    provider: { isMetaMask: true, request: request || (() => {}) },
  };
}

function rabbyEntry(request) {
  return {
    info: { uuid: "rb", name: "Rabby Wallet", rdns: "io.rabby" },
    provider: { isRabby: true, request: request || (() => {}) },
  };
}

function connectDom() {
  document.body.innerHTML =
    '<span id="nav-connect-status"></span>' +
    '<button id="btn-nav-connect" type="button">Connect to trade</button>' +
    '<p id="ticket-status"></p>' +
    '<button id="ticket-submit" type="button" class="ticket-submit connect">Connect wallet</button>';
}

afterEach(() => {
  resetConnectInFlightForTests();
  closeConnectModal();
  delete window.ethereum;
});

describe("connect wiring", () => {
  it("keeps guardProvider on the connectWallet path (embed-shell import must not drop it)", () => {
    const src = readFileSync(join(root, "src/main.js"), "utf8");
    expect(src).toMatch(/import \{ guardProvider \} from "\.\/wallet-guard\.js"/);
    expect(src).toMatch(/const guarded = guardProvider\(provider\)/);
    expect(src).toMatch(/connectFromNav: \(\) => connectFromNav\(\)/);
    expect(src).toMatch(/bindAppListeners\(/);
    expect(src).toMatch(/bindConnectCapture\(connectFromNav\)/);
    const bind = readFileSync(join(root, "src/app-bind.js"), "utf8");
    expect(bind).toMatch(/el\?\.pasteForm\?\.addEventListener/);
    expect(bind).not.toMatch(/el\.pasteForm\.addEventListener/);
    const nav = readFileSync(join(root, "src/nav-connect.js"), "utf8");
    const modal = readFileSync(join(root, "src/connect-modal.js"), "utf8");
    expect(nav).not.toMatch(/setView/);
    expect(nav).toContain("NO_WALLET_MSG");
    expect(nav).toContain("openConnectModal");
    expect(modal).toContain("Install MetaMask or Rabby");
  });

  it("header Connect and ticket Connect wallet both call connectFromNav", () => {
    const main = readFileSync(join(root, "src/main.js"), "utf8");
    const bind = readFileSync(join(root, "src/app-bind.js"), "utf8");
    const trade = readFileSync(join(root, "src/trade.js"), "utf8");
    expect(bind).toContain("bindConnectClick(navBtn");
    expect(bind).toContain("bindConnectCapture(connectFromNav)");
    expect(bind.indexOf("bindConnectClick")).toBeLessThan(bind.indexOf("pasteForm"));
    expect(main).toContain("connectFromNav,");
    expect(trade).toContain('const ticketSubmit = byId("ticket-submit")');
    expect(trade).toContain("ticketSubmit.addEventListener(\"click\", onTicketConnect)");
    expect(trade).toContain("ticketSubmit.onclick = onTicketConnect");
    expect(trade).toContain("app.connectFromNav && app.connectFromNav()");
    expect(trade).toContain('submit.type = "button"');
    const submitAt = trade.indexOf("async function onSubmit");
    expect(trade.slice(submitAt, submitAt + 280)).toContain("app.connectFromNav && app.connectFromNav()");
  });
});

describe("main.js boot without landing paste-form", () => {
  it("binds #btn-nav-connect when #paste-form is missing", () => {
    resetConnectCaptureForTests();
    document.body.innerHTML =
      '<button id="btn-nav-connect" type="button">Connect to trade</button>' +
      '<p id="ticket-status"></p>';
    const connectFromNav = vi.fn();
    expect(() =>
      bindAppListeners({
        el: {
          navConnect: document.getElementById("btn-nav-connect"),
          pasteForm: document.getElementById("paste-form"),
        },
        onPaste: () => {},
        onRefresh: () => {},
        onDisconnect: () => {},
        onWordmark: () => {},
        onPortfolio: () => {},
        onTrade: () => {},
        onOutcome: () => {},
        connectFromNav,
        hideNavWalletMenu: () => {},
      })
    ).not.toThrow();
    expect(document.getElementById("paste-form")).toBeNull();
    document.getElementById("btn-nav-connect").click();
    expect(connectFromNav).toHaveBeenCalled();
  });
});

describe("connect modal", () => {
  it("opens the modal with Install copy when no wallet is present", async () => {
    connectDom();
    const connectWallet = vi.fn();
    const out = await runConnectFromNav({
      discoveredList: [],
      ethereum: null,
      connectWallet,
      discoverMs: 0,
    });
    expect(out.kind).toBe("nowallet");
    expect(connectWallet).not.toHaveBeenCalled();
    const modal = document.getElementById("ht-connect-modal");
    expect(modal).toBeTruthy();
    expect(modal.classList.contains("is-open")).toBe(true);
    expect(modal.textContent).toContain("Connect a wallet");
    expect(modal.textContent).toContain(NO_WALLET_MSG);
    expect(modal.querySelector('a[href="https://metamask.io"]')).toBeTruthy();
    expect(modal.querySelector('a[href="https://rabby.io"]')).toBeTruthy();
    expect(document.getElementById("ticket-status").textContent).toBe(NO_WALLET_MSG);
    expect(document.getElementById("nav-connect-status").textContent).toBe(NO_WALLET_MSG);
    expect(document.getElementById("btn-nav-connect").textContent).toBe(OPENING_WALLET_MSG);
    expect(window.location.pathname).not.toBe("/portfolio");
  });

  it("lists MetaMask and Rabby and does not request until a row is clicked", async () => {
    connectDom();
    const request = vi.fn().mockResolvedValue(["0x1111111111111111111111111111111111111111"]);
    const connectWallet = vi.fn((p) => p.request({ method: "eth_requestAccounts" }));
    const out = await runConnectFromNav({
      discoveredList: [mmEntry(request), rabbyEntry(request)],
      connectWallet,
      discoverMs: 0,
    });
    expect(out.kind).toBe("modal");
    expect(out.targets).toHaveLength(2);
    expect(connectWallet).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    const modal = document.getElementById("ht-connect-modal");
    expect(modal.classList.contains("is-open")).toBe(true);
    expect(modal.textContent).toContain("Connect MetaMask");
    expect(modal.textContent).toContain("Connect Rabby");
    expect(document.getElementById("btn-nav-connect").textContent).toBe(OPENING_WALLET_MSG);
    expect(document.getElementById("ticket-submit").textContent).toBe(OPENING_WALLET_MSG);
    modal.querySelector("[data-wallet='metamask']").click();
    expect(connectWallet).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(document.getElementById("ht-connect-status").textContent).toBe(CHECK_POPUP_MSG);
  });

  it("opens the modal for a single provider and does not auto-request", async () => {
    connectDom();
    const request = vi.fn().mockResolvedValue(["0x1111111111111111111111111111111111111111"]);
    window.ethereum = { isMetaMask: true, request };
    const connectWallet = vi.fn((p) => p.request({ method: "eth_requestAccounts" }));
    const out = await runConnectFromNav({
      discoveredList: [],
      ethereum: window.ethereum,
      connectWallet,
      discoverMs: 0,
    });
    expect(out.kind).toBe("modal");
    expect(connectWallet).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    const modal = document.getElementById("ht-connect-modal");
    expect(modal.classList.contains("is-open")).toBe(true);
    const row = modal.querySelector("[data-wallet='metamask']");
    expect(row).toBeTruthy();
    expect(row.textContent).toContain("Connect MetaMask");
    row.click();
    expect(connectWallet).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("writes Opening wallet immediately on every connect click", async () => {
    connectDom();
    await runConnectFromNav({
      discoveredList: [mmEntry(), rabbyEntry()],
      connectWallet: () => {},
      discoverMs: 0,
    });
    expect(document.getElementById("ticket-status").textContent).toBe("Choose a wallet");
    expect(document.getElementById("btn-nav-connect").textContent).toBe(OPENING_WALLET_MSG);
    expect(document.getElementById("ht-connect-modal").classList.contains("is-open")).toBe(true);
  });
});

describe("walletTargets", () => {
  it("keeps MetaMask and Rabby from EIP-6963 announcements", () => {
    expect(walletKind(mmEntry())).toBe("metamask");
    expect(walletKind(rabbyEntry())).toBe("rabby");
    const picked = walletTargets([mmEntry(), rabbyEntry()]);
    expect(picked).toHaveLength(2);
    expect(picked.find((t) => t.name === "MetaMask").provider.isMetaMask).toBe(true);
    expect(picked.find((t) => t.name === "Rabby").provider.isRabby).toBe(true);
  });

  it("falls back to window.ethereum when nothing announced", () => {
    window.ethereum = { isMetaMask: true, request: () => {} };
    const picked = walletTargets([]);
    expect(picked).toHaveLength(1);
    expect(picked[0].kind).toBe("metamask");
  });
});

describe("EIP-6963 discovery", () => {
  it("collects announceProvider entries after requestProvider", () => {
    const seen = [];
    createWalletDiscovery((list) => {
      seen.push(list.slice());
    });
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: { info: mmEntry().info, provider: mmEntry().provider },
      })
    );
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: { info: rabbyEntry().info, provider: rabbyEntry().provider },
      })
    );
    const last = seen[seen.length - 1];
    expect(last).toHaveLength(2);
    expect(last.map((e) => e.info.name).sort()).toEqual(["MetaMask", "Rabby Wallet"]);
  });
});

describe("paste-address still cannot trade; builder seal unchanged", () => {
  it("blocks paste source and last-writes the builder", () => {
    expect(() => assertCanTrade("paste")).toThrow(/Connect a wallet/);
    const sealed = sealOrderPayload({
      orders: [{ a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" } } }],
      grouping: "na",
      builder: { b: "0xdead", f: 99 },
    });
    expect(sealed.builder.b).toBe(BUILDER_ADDRESS);
    expect(sealed.builder.f).toBe(10);
  });
});

describe("desk header does not eat Connect clicks", () => {
  it("keeps pointer-events on the header connect control", () => {
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    expect(css).toMatch(/html\.desk body > header,[\s\S]*?pointer-events: auto/);
    expect(css).toMatch(/#btn-nav-connect,[\s\S]*?#nav-wallet-menu,[\s\S]*?pointer-events: auto/);
    expect(css).toMatch(/\.btn-connect \{[\s\S]*?pointer-events: auto/);
    expect(css).toMatch(/\.ticket-submit\.connect \{ pointer-events: auto/);
    expect(css).toMatch(/\.ht-connect-modal \{[\s\S]*?z-index: 99999/);
    expect(css).toMatch(/\.ht-connect-modal\.is-open \{[\s\S]*?display: flex !important/);
    expect(css).toMatch(/\.ht-connect-panel \{[\s\S]*?background: var\(--bg-surface\)/);
    expect(css).toMatch(/\.nav-connect-status \{[\s\S]*?font-size: 12px/);
    expect(css).toMatch(/\.ticket-status \{ min-height: 16px/);
    expect(css).toMatch(/\.ticket-foot \{[\s\S]*?overflow: visible/);
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toContain('id="btn-nav-connect"');
    expect(html).toContain('id="nav-connect-status"');
    expect(html).toContain('id="ticket-submit"');
    expect(html).toContain('id="ticket-status"');
    expect(html).toMatch(/id="ticket-status"[\s\S]*id="ticket-submit"/);
    expect(html).toContain('type="button" id="ticket-submit"');
    const vite = readFileSync(join(root, "vite.config.js"), "utf8");
    expect(vite).toMatch(/server:\s*\{[\s\S]*?port:\s*5173/);
    expect(vite).toMatch(/strictPort:\s*false/);
    expect(vite).toMatch(/preview:\s*\{[\s\S]*?port:\s*4173/);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.dev).toBe("node scripts/prepare-tv-embed.mjs && vite");
    expect(pkg.scripts.dev).not.toMatch(/4173/);
    expect(pkg.scripts.preview).toContain("4173");
  });
});
