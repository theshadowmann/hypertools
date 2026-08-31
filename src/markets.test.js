import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  coinIconUrl,
  compactUsd,
  displayPair,
  filterMarkets,
  formatPickerChange,
  funding8h,
  iconSymbol,
  loadFavs,
  parsePerpMarkets,
  parseSpotMarkets,
  SPOT_ASSET_OFFSET,
  toggleFav,
} from "./markets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const perps = parsePerpMarkets([
  {
    universe: [
      { name: "BTC", szDecimals: 5, maxLeverage: 40 },
      { name: "ETH", szDecimals: 4, maxLeverage: 25 },
    ],
  },
  [
    { markPx: "100000", prevDayPx: "90000", dayNtlVlm: "50", funding: "0.0001", openInterest: "10", oraclePx: "100001" },
    { markPx: "3000", prevDayPx: "3100", dayNtlVlm: "20", funding: "-0.0002", openInterest: "5", oraclePx: "3001" },
  ],
]);

const spot = parseSpotMarkets([
  {
    universe: [{ tokens: [1, 0], name: "PURR/USDC", index: 0, isCanonical: true }],
    tokens: [
      { name: "USDC", index: 0, szDecimals: 8 },
      { name: "PURR", index: 1, szDecimals: 0 },
    ],
  },
  [{ coin: "PURR/USDC", markPx: "0.12", prevDayPx: "0.10", dayNtlVlm: "1000" }],
]);

describe("parse markets", () => {
  it("builds perp rows from metaAndAssetCtxs", () => {
    expect(perps[0].id).toBe("perp:BTC");
    expect(perps[0].pair).toBe("BTC/USDC");
    expect(perps[0].kind).toBe("perp");
    expect(perps[0].asset).toBe(0);
  });

  it("builds spot rows with 10000+index asset ids", () => {
    expect(spot[0].id).toBe("spot:PURR/USDC");
    expect(spot[0].pair).toBe("PURR/USDC");
    expect(spot[0].base).toBe("PURR");
    expect(spot[0].asset).toBe(SPOT_ASSET_OFFSET);
    expect(spot[0].funding).toBeNull();
  });
});

describe("picker filter", () => {
  const all = perps.concat(spot);

  it("filters by ticker search", () => {
    const rows = filterMarkets(all, { tab: "all", query: "purr" });
    expect(rows.map((m) => m.id)).toEqual(["spot:PURR/USDC"]);
  });

  it("tabs Perps / Spot without inventing rows", () => {
    expect(filterMarkets(all, { tab: "perps" }).every((m) => m.kind === "perp")).toBe(true);
    expect(filterMarkets(all, { tab: "spot" }).every((m) => m.kind === "spot")).toBe(true);
  });

  it("can restrict the picker to outcome rows only", () => {
    const mixed = all.concat([{ id: "outcome:1:0", kind: "outcome", coin: "#10", pair: "BTC above 1?", markPx: "0.4" }]);
    const rows = filterMarkets(mixed, { tab: "all", kinds: ["outcome"] });
    expect(rows.every((m) => m.kind === "outcome")).toBe(true);
    expect(filterMarkets(mixed, { tab: "outcome" }).map((m) => m.id)).toEqual(["outcome:1:0"]);
    expect(filterMarkets(mixed, { tab: "all" }).some((m) => m.kind === "outcome")).toBe(true);
    expect(filterMarkets(mixed, { tab: "perps" }).some((m) => m.kind === "outcome")).toBe(false);
  });

  it("keeps picker category words Favorites All Perps Spot Outcome Trending", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const tabs = [...html.matchAll(/data-mp-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(["favorites", "all", "perps", "spot", "outcome", "trending"]);
  });

  it("favorites tab uses stored ids only", () => {
    const rows = filterMarkets(all, { tab: "favorites", favs: ["perp:ETH"] });
    expect(rows.map((m) => m.id)).toEqual(["perp:ETH"]);
  });

  it("sorts 24h change", () => {
    const desc = filterMarkets(perps, { tab: "perps", sortKey: "change", sortDir: "desc" });
    expect(desc[0].coin).toBe("BTC");
    const asc = filterMarkets(perps, { tab: "perps", sortKey: "change", sortDir: "asc" });
    expect(asc[0].coin).toBe("ETH");
  });

  it("keeps missing 24h change after real values in both directions", () => {
    const mixed = [
      { coin: "BTC", pair: "BTC/USDC", kind: "perp", markPx: "100", prevDayPx: "90" },
      { coin: "Z", pair: "Z/USDC", kind: "perp", markPx: "1", prevDayPx: "0" },
      { coin: "ETH", pair: "ETH/USDC", kind: "perp", markPx: "3", prevDayPx: "4" },
    ];
    expect(filterMarkets(mixed, { tab: "perps", sortKey: "change", sortDir: "desc" }).map((m) => m.coin)).toEqual([
      "BTC",
      "ETH",
      "Z",
    ]);
    expect(filterMarkets(mixed, { tab: "perps", sortKey: "change", sortDir: "asc" }).map((m) => m.coin)).toEqual([
      "ETH",
      "BTC",
      "Z",
    ]);
  });

  it("formats live 24h change as signed price / pct", () => {
    expect(formatPickerChange("100000", "90000")).toEqual({
      text: "+$10,000.00 / +11.11%",
      cls: "mp-chg up",
    });
    expect(formatPickerChange("3000", "3100")).toEqual({
      text: "-$100.00 / -3.23%",
      cls: "mp-chg down",
    });
    expect(formatPickerChange("1", "0")).toEqual({ text: "—", cls: "mp-muted" });
  });
});

describe("picker 24h sort chrome", () => {
  it("puts a chevron on 24h Change and defaults to greatest-first", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const trade = readFileSync(join(root, "src/trade.js"), "utf8");
    expect(html).toMatch(/data-mp-sort="change"[^>]*aria-sort="desc"/);
    expect(html).toMatch(/class="mp-sort-chevron"/);
    expect(trade).toMatch(/let pickerSort = "change"/);
    expect(trade).toMatch(/let pickerDir = "desc"/);
    expect(css).toMatch(/button\[aria-sort="asc"\] \.mp-sort-chevron/);
  });

  it("aligns picker headers and numeric cells on the same columns", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    expect(html).toMatch(/<colgroup>[\s\S]*mp-col-mkt[\s\S]*mp-col-oi[\s\S]*<\/colgroup>/);
    expect(css).toMatch(/\.mp-table \{\s*width: 100%;\s*table-layout: fixed;/);
    expect(css).toMatch(/\.mp-table th,\s*\.mp-table td \{[\s\S]*padding: 6px 12px;[\s\S]*text-align: right;/);
    expect(css).toMatch(/th:first-child,\s*\.mp-table td:first-child \{ text-align: left; \}/);
    expect(css).toMatch(/th button \{[\s\S]*width: 100%;/);
    expect(css).not.toMatch(/\.mp-row td \{\s*padding: 5px 10px/);
  });
});

describe("funding and display", () => {
  it("converts hourly funding to 8h", () => {
    expect(funding8h(0.0000125)).toBeCloseTo(0.0001);
  });

  it("formats compact USD from live-scale notionals", () => {
    expect(compactUsd(2.21e9)).toBe("$2.21B");
    expect(displayPair("PURR", "USDC")).toBe("PURR/USDC");
  });

  it("builds official Hyperliquid coin icon URLs only", () => {
    expect(coinIconUrl("HYPE")).toBe("https://app.hyperliquid.xyz/coins/HYPE.svg");
    expect(coinIconUrl("kPEPE")).toBe("https://app.hyperliquid.xyz/coins/PEPE.svg");
    expect(coinIconUrl("PURR/USDC")).toBeNull();
    expect(coinIconUrl("../HYPE")).toBeNull();
    expect(coinIconUrl("javascript:alert(1)")).toBeNull();
    expect(iconSymbol({ kind: "spot", base: "HYPE", coin: "HYPE/USDC" })).toBe("HYPE");
    expect(iconSymbol({ kind: "perp", coin: "BTC" })).toBe("BTC");
    expect(iconSymbol({ kind: "outcome", underlying: "BTC", coin: "#12100" })).toBe("BTC");
  });
});

describe("favorites store", () => {
  it("toggles ids in the provided store", () => {
    const mem = {};
    const store = {
      getItem: (k) => mem[k] || null,
      setItem: (k, v) => {
        mem[k] = v;
      },
    };
    expect(loadFavs(store)).toEqual([]);
    expect(toggleFav("perp:BTC", store)).toEqual(["perp:BTC"]);
    expect(toggleFav("perp:BTC", store)).toEqual([]);
  });
});
