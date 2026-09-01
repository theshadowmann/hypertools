/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDER_ADDRESS, sealOrderPayload, assertCanTrade } from "./order-build.js";
import { bindAppListeners } from "./app-bind.js";
import { NO_WALLET_MSG, runConnectFromNav, showConnectStatus } from "./nav-connect.js";
import {
  createWalletDiscovery,
  walletKind,
  walletTargets,
} from "./wallet.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function mmEntry() {
  return {
    info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" },
    provider: { isMetaMask: true, request: () => {} },
  };
}

function rabbyEntry() {
  return {
    info: { uuid: "rb", name: "Rabby Wallet", rdns: "io.rabby" },
    provider: { isRabby: true, request: () => {} },
  };
}

describe("connect wiring", () => {
  it("keeps guardProvider on the connectWallet path (embed-shell import must not drop it)", () => {
    const src = readFileSync(join(root, "src/main.js"), "utf8");
    expect(src).toMatch(/import \{ guardProvider \} from "\.\/wallet-guard\.js"/);
    expect(src).toMatch(/const guarded = guardProvider\(provider\)/);
    expect(src).toMatch(/connectFromNav: \(\) => connectFromNav\(\)/);
    expect(src).toMatch(/bindAppListeners\(/);
    const bind = readFileSync(join(root, "src/app-bind.js"), "utf8");
    expect(bind).toMatch(/el\?\.pasteForm\?\.addEventListener/);
    expect(bind).not.toMatch(/el\.pasteForm\.addEventListener/);
    const nav = readFileSync(join(root, "src/nav-connect.js"), "utf8");
    expect(nav).not.toMatch(/setView/);
    expect(nav).toContain("Install MetaMask or Rabby");
  });

  it("header Connect and ticket Connect wallet both call connectFromNav", () => {
    const main = readFileSync(join(root, "src/main.js"), "utf8");
    const bind = readFileSync(join(root, "src/app-bind.js"), "utf8");
    const trade = readFileSync(join(root, "src/trade.js"), "utf8");
    expect(bind).toContain("el.navConnect.addEventListener(\"click\"");
    expect(bind.indexOf("el.navConnect.addEventListener")).toBeLessThan(bind.indexOf("pasteForm"));
    expect(main).toContain("connectFromNav,");
    expect(trade).toContain('byId("ticket-submit")?.addEventListener("click"');
    const clickAt = trade.indexOf('byId("ticket-submit")?.addEventListener("click"');
    expect(trade.slice(clickAt, clickAt + 280)).toContain("app.connectFromNav && app.connectFromNav()");
    const submitAt = trade.indexOf("async function onSubmit");
    expect(trade.slice(submitAt, submitAt + 280)).toContain("app.connectFromNav && app.connectFromNav()");
  });

  it("opens the EIP-6963 picker when MetaMask and Rabby are both present", () => {
    const main = readFileSync(join(root, "src/main.js"), "utf8");
    expect(main).toMatch(/function connectFromNav\(\)/);
    expect(main).toMatch(/runConnectFromNav\(/);
    const targets = walletTargets([mmEntry(), rabbyEntry()]);
    expect(targets.map((t) => t.kind).sort()).toEqual(["metamask", "rabby"]);
    expect(targets).toHaveLength(2);
    const shown = [];
    const out = runConnectFromNav({
      discoveredList: [mmEntry(), rabbyEntry()],
      connectWallet: () => {},
      showMenu: (t) => shown.push(t),
      hideMenu: () => {},
      onNoWallet: () => {},
    });
    expect(out.kind).toBe("menu");
    expect(shown[0]).toHaveLength(2);
  });
});

describe("main.js boot without landing paste-form", () => {
  it("binds #btn-nav-connect when #paste-form is missing", () => {
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
    expect(connectFromNav).toHaveBeenCalledTimes(1);
  });
});

describe("connectFromNav", () => {
  afterEach(() => {
    delete window.ethereum;
  });

  it("calls eth_requestAccounts on a mock injected provider", async () => {
    const request = vi.fn().mockResolvedValue(["0x1111111111111111111111111111111111111111"]);
    window.ethereum = { isMetaMask: true, request };
    const calls = [];
    const out = runConnectFromNav({
      discoveredList: [],
      ethereum: window.ethereum,
      connectWallet: (p) => {
        calls.push(p);
        return p.request({ method: "eth_requestAccounts" });
      },
      showMenu: () => {},
      hideMenu: () => {},
      onNoWallet: () => {},
    });
    expect(out.kind).toBe("connect");
    expect(calls[0]).toBe(window.ethereum);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("stays on /trade and writes ticket-status when no wallet is present", () => {
    document.body.innerHTML = '<p id="ticket-status" class="ticket-status"></p>';
    const out = runConnectFromNav({
      discoveredList: [],
      ethereum: null,
      connectWallet: () => {},
      showMenu: () => {},
      hideMenu: () => {},
    });
    expect(out.kind).toBe("nowallet");
    showConnectStatus(NO_WALLET_MSG, "err");
    const st = document.getElementById("ticket-status");
    expect(st.textContent).toBe("Install MetaMask or Rabby");
    expect(st.classList.contains("err")).toBe(true);
  });
});

describe("walletTargets", () => {
  afterEach(() => {
    delete window.ethereum;
  });

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
    expect(css).toMatch(/html\.desk body > header \{[\s\S]*?pointer-events: auto/);
    expect(css).toMatch(/#btn-nav-connect,[\s\S]*?#nav-wallet-menu \{[\s\S]*?pointer-events: auto/);
    expect(css).toMatch(/\.btn-connect \{[\s\S]*?pointer-events: auto/);
    expect(css).toMatch(/\.ticket-submit\.connect \{ pointer-events: auto/);
    expect(css).toMatch(/#nav-wallet-menu \{[\s\S]*?z-index: 80/);
  });
});
