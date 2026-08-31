import { describe, expect, it } from "vitest";
import { getAgent, rememberAgent, wipeAgents } from "./agent-store.js";
import { HL_API, HL_EXCHANGE, HL_INFO, HL_WS } from "./hosts.js";
import { assertHlTypedData, guardProvider } from "./wallet-guard.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AGENT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("hosts", () => {
  it("pins official Hyperliquid mainnet URLs", () => {
    expect(HL_API).toBe("https://api.hyperliquid.xyz");
    expect(HL_INFO).toBe("https://api.hyperliquid.xyz/info");
    expect(HL_EXCHANGE).toBe("https://api.hyperliquid.xyz/exchange");
    expect(HL_WS).toBe("wss://api.hyperliquid.xyz/ws");
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
