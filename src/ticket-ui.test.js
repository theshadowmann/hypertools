/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTicketKind } from "./ticket-ui.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

describe("spot vs perp ticket chrome", () => {
  function mount() {
    const chip = html.slice(html.indexOf('id="market-chip"'), html.indexOf('id="market-picker"'));
    const ticket = html.slice(html.indexOf('<form id="ticket-form"'), html.indexOf('id="trade-balances"'));
    document.body.innerHTML = "<div>" + chip + "</div>" + ticket;
  }

  it("omits liquidation, margin, and leverage on a spot market", () => {
    mount();
    applyTicketKind(document, true);
    expect(document.getElementById("lev-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sum-liq-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sum-margin-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sum-slip-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("side-buy").textContent).toBe("Buy");
    expect(document.getElementById("side-sell").textContent).toBe("Sell");
    expect(document.querySelector(".ls-tabs").classList.contains("spot-sides")).toBe(true);
    expect(document.getElementById("market-chip-lev").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sum-value")).toBeTruthy();
    expect(document.getElementById("sum-fees")).toBeTruthy();
  });

  it("keeps liquidation, margin, and leverage on a perp", () => {
    mount();
    applyTicketKind(document, true);
    applyTicketKind(document, false);
    expect(document.getElementById("lev-row").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("sum-liq-row").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("sum-margin-row").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("side-buy").textContent).toBe("Buy / Long");
    expect(document.getElementById("side-sell").textContent).toBe("Sell / Short");
    expect(document.querySelector(".ls-tabs").classList.contains("spot-sides")).toBe(false);
    expect(document.getElementById("market-chip-lev").classList.contains("hidden")).toBe(false);
  });

  it("shows Yes/No odds, Limit dropdown, TIF, and payout on an outcome market", () => {
    mount();
    applyTicketKind(document, "outcome");
    expect(document.getElementById("lev-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sum-liq-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sum-margin-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sum-slip-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("side-buy").textContent).toBe("Buy");
    expect(document.getElementById("side-sell").textContent).toBe("Sell");
    expect(document.querySelector(".ls-tabs").classList.contains("spot-sides")).toBe(false);
    expect(document.querySelector(".ls-tabs").classList.contains("outcome-sides")).toBe(true);
    expect(document.getElementById("outcome-legs").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("outcome-otype").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("outcome-tif-wrap").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("sum-payout-row").classList.contains("hidden")).toBe(false);
    expect(document.querySelector(".type-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("ticket-chk-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("ticket-price-k").textContent).toBe("Price (USDC)");
    expect(document.getElementById("market-chip-lev").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("ticket-submit")).toBeTruthy();
  });
});
