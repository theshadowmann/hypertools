/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIMIT_CLOSE_TIP,
  SKIP_PERP_MARKET_CLOSE_KEY,
  bindPerpCloseApp,
  canClosePerps,
  closeCoinSizeForRow,
  closeNotional,
  closePerpCloseAllModal,
  closePerpCloseModal,
  closeSideForPosition,
  closeSizeFromPct,
  isPerpCloseModalOpen,
  marketForPerpRow,
  midForPerpRow,
  openPerpCloseModal,
  pctFromCloseSize,
  positionAbsSize,
  positionIsLong,
  runCloseAllPerps,
  setSkipPerpMarketCloseModal,
  sizeFromNotional,
  skipPerpMarketCloseModal,
} from "./perp-close.js";
import { buildPositionsTable } from "./dashboard.js";

afterEach(() => {
  closePerpCloseModal();
  closePerpCloseAllModal();
  bindPerpCloseApp(() => null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("perp close math", () => {
  it("maps long/short to opposite reduce-only sides", () => {
    expect(positionIsLong({ szi: "1.5" })).toBe(true);
    expect(positionIsLong({ szi: "-2" })).toBe(false);
    expect(positionAbsSize({ szi: "-2.5" })).toBe(2.5);
    expect(closeSideForPosition({ szi: 1 })).toBe("sell");
    expect(closeSideForPosition({ szi: -1 })).toBe("buy");
  });

  it("sizes from percent and notional without exceeding abs(szi)", () => {
    expect(closeSizeFromPct(1, 100, 4)).toBe(1);
    expect(closeSizeFromPct(1, 50, 4)).toBe(0.5);
    expect(closeSizeFromPct(1, 0, 4)).toBe(0);
    expect(pctFromCloseSize(0.5, 1)).toBe(50);
    expect(closeNotional(0.5, 100)).toBe(50);
    expect(sizeFromNotional(50, 100, 1, 4)).toBe(0.5);
    expect(sizeFromNotional(999, 100, 0.25, 4)).toBe(0.25);
  });

  it("resolves perp market and mid from row + mids", () => {
    const markets = [
      { id: "perp:BTC", kind: "perp", coin: "BTC", szDecimals: 5 },
      { id: "spot:HYPE", kind: "spot", coin: "HYPE", szDecimals: 2 },
    ];
    expect(marketForPerpRow({ coin: "BTC" }, markets).id).toBe("perp:BTC");
    expect(marketForPerpRow({ coin: "ETH" }, markets)).toBeNull();
    expect(midForPerpRow({ coin: "BTC", entryPx: 1 }, { BTC: 65000 })).toBe(65000);
    expect(midForPerpRow({ coin: "BTC", entryPx: "100" }, {})).toBe(100);
  });

  it("prefers market mid/mark when allMids map is empty (core fast path)", () => {
    const mkt = { coin: "BTC", kind: "perp", midPx: "75756", markPx: "75700", szDecimals: 5 };
    expect(midForPerpRow({ coin: "BTC", entryPx: "75930" }, {}, mkt)).toBe(75756);
    expect(midForPerpRow({ coin: "BTC", entryPx: "75930" }, {}, { markPx: "75700" })).toBe(75700);
  });

  it("closeCoinSizeForRow uses abs(szi) even when positionValue is USDC display", () => {
    const markets = [{ id: "perp:BTC", kind: "perp", coin: "BTC", szDecimals: 5, asset: 0 }];
    const row = {
      coin: "BTC",
      szi: "0.00048",
      positionValue: "36.36",
      entryPx: "75930.60",
    };
    expect(positionAbsSize(row)).toBe(0.00048);
    expect(closeCoinSizeForRow(row, markets)).toBe(0.00048);
    // Must not treat $36.36 notional as coin size
    expect(closeCoinSizeForRow(row, markets)).not.toBe(36.36);
  });

  it("gates close to connected wallets only", () => {
    expect(canClosePerps({ source: "wallet", provider: {}, address: "0x1" })).toBe(true);
    expect(canClosePerps({ source: "paste", provider: null, address: "0x1" })).toBe(false);
    expect(canClosePerps({ source: "wallet", provider: null, address: "0x1" })).toBe(false);
  });

  it("persists Don't show this again on a storage stub", () => {
    const mem = {};
    const storage = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => {
        mem[k] = String(v);
      },
      removeItem: (k) => {
        delete mem[k];
      },
    };
    expect(skipPerpMarketCloseModal(storage)).toBe(false);
    setSkipPerpMarketCloseModal(true, storage);
    expect(mem[SKIP_PERP_MARKET_CLOSE_KEY]).toBe("1");
    expect(skipPerpMarketCloseModal(storage)).toBe(true);
    setSkipPerpMarketCloseModal(false, storage);
    expect(skipPerpMarketCloseModal(storage)).toBe(false);
  });
});

describe("perp positions close UI", () => {
  const row = {
    coin: "BTC",
    szi: "0.5",
    entryPx: "60000",
    liquidationPx: "50000",
    leverage: { value: 5, type: "cross" },
    unrealizedPnl: "100",
    positionValue: "30000",
  };

  it("renders Limit | Market and Close All when showClose is on", () => {
    let limit = null;
    let market = null;
    let closeAll = 0;
    const tableWrap = buildPositionsTable([row], { BTC: 65000 }, {
      showClose: true,
      onLimit: (p) => {
        limit = p;
      },
      onMarket: (p) => {
        market = p;
      },
      onCloseAll: () => {
        closeAll += 1;
      },
    });
    const text = tableWrap.textContent;
    expect(text).toContain("Limit");
    expect(text).toContain("Market");
    expect(text).toContain("Close All");
    const limitBtn = [...tableWrap.querySelectorAll("button")].find((b) => b.textContent === "Limit");
    const marketBtn = [...tableWrap.querySelectorAll("button")].find((b) => b.textContent === "Market");
    const allBtn = [...tableWrap.querySelectorAll("button")].find((b) => b.textContent === "Close All");
    expect(limitBtn.title).toBe(LIMIT_CLOSE_TIP);
    expect(limitBtn.className).toMatch(/orders-cancel/);
    expect(marketBtn.className).toMatch(/out-close/);
    limitBtn.click();
    marketBtn.click();
    allBtn.click();
    expect(limit).toBe(row);
    expect(market).toBe(row);
    expect(closeAll).toBe(1);
  });

  it("shows SIZE as USDC notional via positionValue (fmtUsd), not coin qty", () => {
    const tableWrap = buildPositionsTable([row], { BTC: 65000 }, { showClose: false });
    const tds = [...tableWrap.querySelectorAll("tbody tr td")];
    expect(tds[2].textContent).toBe("$30,000.00");
    expect(tableWrap.textContent).not.toMatch(/\b0\.5\b/);
  });

  it("falls back to abs(szi)*mark when positionValue missing", () => {
    const bare = { ...row };
    delete bare.positionValue;
    const tableWrap = buildPositionsTable([bare], { BTC: 65000 }, { showClose: false });
    const tds = [...tableWrap.querySelectorAll("tbody tr td")];
    expect(tds[2].textContent).toBe("$32,500.00");
  });

  it("omits close actions for pasted / showClose false", () => {
    const tableWrap = buildPositionsTable([row], { BTC: 65000 }, { showClose: false });
    expect([...tableWrap.querySelectorAll("button")].some((b) => b.textContent === "Limit")).toBe(false);
    expect([...tableWrap.querySelectorAll("button")].some((b) => b.textContent === "Close All")).toBe(false);
  });

  it("opens Limit Close with Mid and Confirm", () => {
    openPerpCloseModal({ kind: "limit", row, mids: { BTC: 65000 } });
    expect(isPerpCloseModalOpen()).toBe(true);
    const modal = document.getElementById("ht-perp-close-modal");
    expect(modal.textContent).toContain("Limit Close");
    expect(modal.textContent).toContain("Mid");
    expect(modal.textContent).toContain("Confirm");
    expect(modal.querySelector("#perp-close-price")).toBeTruthy();
    closePerpCloseModal();
    expect(isPerpCloseModalOpen()).toBe(false);
  });

  it("opens Market Close with coral size and Don't show this again", () => {
    openPerpCloseModal({ kind: "market", row, mids: { BTC: 65000 } });
    const modal = document.getElementById("ht-perp-close-modal");
    expect(modal.textContent).toContain("Market Close");
    expect(modal.textContent).toContain("Don't show this again");
    expect(modal.querySelector("#perp-close-submit").textContent).toBe("Market Close");
    expect(modal.querySelector(".out-close-coral").textContent).toMatch(/BTC/);
  });
});

describe("runCloseAllPerps errors and size wiring", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("surfaces real exchange errors instead of generic Close All failed.", async () => {
    vi.doMock("./agent-store.js", () => ({
      getAgent: () => ({ privateKey: "0xabc", address: "0xagent" }),
      rememberAgent: () => {},
      wipeAgents: () => {},
    }));
    vi.doMock("./hl-trade.js", () => ({
      enableTrading: vi.fn(),
      tradingStatus: vi.fn(async () => ({ feeOk: true, agentOk: true })),
      placePerpOrder: vi.fn(async () => {
        throw new Error("Insufficient margin to place order.");
      }),
      userMessage: (err) => (err && err.message) || "Request failed.",
    }));

    const { bindPerpCloseApp, runCloseAllPerps } = await import("./perp-close.js");
    bindPerpCloseApp(() => ({
      state: {
        source: "wallet",
        address: "0xfcf0",
        provider: {},
        markets: [{ id: "perp:BTC", kind: "perp", coin: "BTC", szDecimals: 5, asset: 0, markPx: "75756" }],
        data: { mids: { BTC: 75756 } },
      },
      setStatus: () => {},
    }));

    const row = {
      coin: "BTC",
      szi: "0.00048",
      positionValue: "36.36",
      entryPx: "75930.60",
    };
    await expect(
      runCloseAllPerps({
        rows: [row],
        markets: [{ id: "perp:BTC", kind: "perp", coin: "BTC", szDecimals: 5, asset: 0, markPx: "75756" }],
        mids: { BTC: 75756 },
        gapMs: 0,
      })
    ).rejects.toThrow(/Insufficient margin/);
  });

  it("submits reduce-only sell using coin szi not USDC positionValue", async () => {
    const placed = [];
    vi.doMock("./agent-store.js", () => ({
      getAgent: () => ({ privateKey: "0xabc", address: "0xagent" }),
      rememberAgent: () => {},
      wipeAgents: () => {},
    }));
    vi.doMock("./hl-trade.js", () => ({
      enableTrading: vi.fn(),
      tradingStatus: vi.fn(async () => ({ feeOk: true, agentOk: true })),
      placePerpOrder: vi.fn(async (args) => {
        placed.push(args);
        return { status: "ok" };
      }),
      userMessage: (err) => (err && err.message) || "Request failed.",
    }));

    const { bindPerpCloseApp, runCloseAllPerps } = await import("./perp-close.js");
    bindPerpCloseApp(() => ({
      state: {
        source: "wallet",
        address: "0xfcf0",
        provider: {},
        markets: [{ id: "perp:BTC", kind: "perp", coin: "BTC", szDecimals: 5, asset: 0, markPx: "75756" }],
        data: { mids: {} },
      },
      setStatus: () => {},
      reloadAccount: () => {},
    }));

    const row = {
      coin: "BTC",
      szi: "0.00048",
      positionValue: "36.36",
      entryPx: "75930.60",
    };
    const result = await runCloseAllPerps({
      rows: [row],
      markets: [{ id: "perp:BTC", kind: "perp", coin: "BTC", szDecimals: 5, asset: 0, markPx: "75756", midPx: "75756" }],
      mids: {},
      gapMs: 0,
    });
    expect(result.ok).toBe(1);
    expect(result.failed).toBe(0);
    expect(placed).toHaveLength(1);
    expect(placed[0].side).toBe("sell");
    expect(placed[0].reduceOnly).toBe(true);
    expect(placed[0].size).toBe(0.00048);
    expect(placed[0].type).toBe("market");
    expect(placed[0].mid).toBe(75756);
  });
});
