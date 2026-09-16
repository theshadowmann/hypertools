import { beforeEach, describe, expect, it, vi } from "vitest";

describe("invalidateAgentOnWalletError", () => {
  beforeEach(() => {
    vi.resetModules();
    // Minimal sessionStorage for agent-store
    const store = {};
    globalThis.sessionStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (i) => Object.keys(store)[i] || null,
    };
  });

  it("clears the stored agent when HL says API Wallet does not exist", async () => {
    const { rememberAgent, getAgent } = await import("./agent-store.js");
    const { invalidateAgentOnWalletError } = await import("./hl-trade.js");
    const user = "0xfcf0489200000000000000000000000000004892";
    rememberAgent(user, {
      privateKey: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      address: "0x6560e4e92692c08b87956bacee78980703bbbcd7",
    });
    expect(getAgent(user)).not.toBeNull();

    const cleared = invalidateAgentOnWalletError(
      user,
      new Error(
        "User or API Wallet 0x6560e4e92692c08b87956bacee78980703bbbcd7 does not exist."
      )
    );
    expect(cleared).toBe(true);
    expect(getAgent(user)).toBeNull();
  });

  it("does not clear the agent on unrelated errors", async () => {
    const { rememberAgent, getAgent, wipeAgents } = await import("./agent-store.js");
    const { invalidateAgentOnWalletError } = await import("./hl-trade.js");
    const user = "0xfcf0489200000000000000000000000000004892";
    rememberAgent(user, {
      privateKey: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      address: "0x6560e4e92692c08b87956bacee78980703bbbcd7",
    });
    expect(invalidateAgentOnWalletError(user, new Error("Insufficient margin"))).toBe(false);
    expect(getAgent(user)).not.toBeNull();
    wipeAgents();
  });
});
