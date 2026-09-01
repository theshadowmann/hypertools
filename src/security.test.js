import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getAgent, rememberAgent, wipeAgents } from "./agent-store.js";
import { HL_API, HL_APP, HL_APP_PORTFOLIO, HL_COIN_ICON_BASE, HL_EXCHANGE, HL_FEES_DOCS, HL_INFO, HL_WS } from "./hosts.js";
import { assertHlTypedData, guardProvider } from "./wallet-guard.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AGENT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("hosts", () => {
  it("pins official Hyperliquid mainnet URLs", () => {
    expect(HL_API).toBe("https://api.hyperliquid.xyz");
    expect(HL_INFO).toBe("https://api.hyperliquid.xyz/info");
    expect(HL_EXCHANGE).toBe("https://api.hyperliquid.xyz/exchange");
    expect(HL_WS).toBe("wss://api.hyperliquid.xyz/ws");
    expect(HL_APP).toBe("https://app.hyperliquid.xyz");
    expect(HL_APP_PORTFOLIO).toBe("https://app.hyperliquid.xyz/portfolio");
    expect(HL_FEES_DOCS).toBe("https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees");
    expect(HL_COIN_ICON_BASE).toBe("https://app.hyperliquid.xyz/coins/");
  });
});

describe("CSP", () => {
  it("allowlists TradingView without opening script-src to the web", () => {
    const json = JSON.parse(readFileSync(join(root, "staticwebapp.config.json"), "utf8"));
    const csp = json.globalHeaders["Content-Security-Policy"];
    expect(csp).toMatch(/script-src 'self' https:\/\/s3\.tradingview\.com https:\/\/s\.tradingview\.com/);
    expect(csp).not.toMatch(/script-src[^;]*\*/);
    expect(csp).toMatch(/frame-src 'self' https:\/\/www\.tradingview-widget\.com/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/api\.hyperliquid\.xyz wss:\/\/api\.hyperliquid\.xyz/);
    expect(csp).toMatch(/img-src 'self' data: https:\/\/app\.hyperliquid\.xyz/);
    expect(csp).not.toMatch(/img-src[^;]*\*/);
    expect(csp).not.toMatch(/cdnjs|jsdelivr|unpkg|googleapis/);
    expect(json.navigationFallback.rewrite).toBe("/index.html");
    expect(json.navigationFallback.exclude).toContain("/embed-widget/*");
    expect(json.navigationFallback.exclude).toContain("/embed-widget/advanced-chart");
    expect(json.navigationFallback.exclude).toContain("/embed-widget/advanced-chart/");
    const chartBare = json.routes.find((r) => r.route === "/embed-widget/advanced-chart");
    const chartSlash = json.routes.find((r) => r.route === "/embed-widget/advanced-chart/");
    expect(chartBare.rewrite).toBe("/embed-widget/advanced-chart/index.html");
    expect(chartSlash.rewrite).toBe("/embed-widget/advanced-chart/index.html");
    expect(json.routes.findIndex((r) => r.route === "/embed-widget/advanced-chart")).toBeLessThan(
      json.routes.findIndex((r) => r.route === "/embed-widget/*")
    );
    const embed = json.routes.find((r) => r.route === "/embed-widget/*");
    expect(embed.headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(embed.headers["Content-Security-Policy"]).toMatch(/frame-ancestors 'self'/);
    expect(embed.headers["Content-Security-Policy"]).toMatch(/unsafe-inline/);
    expect(embed.headers["Content-Security-Policy"]).toMatch(/connect-src 'self'/);
  });
});

describe("agent store", () => {
  it("wipes the agent key on disconnect", () => {
    rememberAgent(USER, { privateKey: "0xsecret-agent-key", address: AGENT });
    expect(getAgent(USER).privateKey).toBe("0xsecret-agent-key");
    wipeAgents();
    expect(getAgent(USER)).toBeNull();
  });

  it("strips leftover plaintext localStorage keys", () => {
    const store = {};
    globalThis.localStorage = {
      length: 1,
      key: () => "ht.agent." + USER,
      getItem: (k) => store[k],
      setItem: (k, v) => {
        store[k] = v;
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
    store["ht.agent." + USER] = JSON.stringify({ privateKey: "0xlegacy", address: AGENT });
    globalThis.localStorage.length = 1;
    wipeAgents();
    expect(store["ht.agent." + USER]).toBeUndefined();
  });
});

describe("wallet guard", () => {
  it("rejects personal_sign, eth_sign, and eth_sendTransaction", async () => {
    const p = guardProvider({
      request: async () => "should-not-run",
    });
    await expect(p.request({ method: "personal_sign", params: ["hi", USER] })).rejects.toThrow(
      /not allowed/
    );
    await expect(p.request({ method: "eth_sign", params: [USER, "0x"] })).rejects.toThrow(/not allowed/);
    await expect(p.request({ method: "eth_sendTransaction", params: [{}] })).rejects.toThrow(
      /not allowed/
    );
  });

  it("rejects typed data that is not official Hyperliquid EIP-712", () => {
    expect(() => assertHlTypedData({ domain: { name: "Evil" }, message: {} })).toThrow(
      /unexpected typed data/
    );
  });

  it("allows Exchange and HyperliquidSignTransaction typed data", async () => {
    const p = guardProvider({
      request: async () => "sig",
    });
    await expect(
      p.request({
        method: "eth_signTypedData_v4",
        params: [USER, JSON.stringify({ domain: { name: "Exchange" } })],
      })
    ).resolves.toBe("sig");
    await expect(
      p.request({
        method: "eth_signTypedData_v4",
        params: [USER, { domain: { name: "HyperliquidSignTransaction" } }],
      })
    ).resolves.toBe("sig");
  });
});
