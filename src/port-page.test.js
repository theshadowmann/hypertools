/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { drawPnlChart, renderDashboard } from "./dashboard.js";
import { h } from "./dom.js";
import { HL_APP_PORTFOLIO, HL_FEES_DOCS } from "./hosts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeEach(() => {
  document.body.innerHTML = "";
});

function mount() {
  const dash = document.createElement("section");
  dash.id = "dashboard";
  dash.innerHTML = `
    <h1 class="port-title">Portfolio</h1>
    <div id="port-paste-wrap"></div>
    <p id="port-14d-vol"></p>
    <span id="port-fee-perp-taker"></span>
    <span id="port-fee-perp-maker"></span>
    <div id="port-fee-spot-row" class="port-fee-row">
      <span id="port-fee-spot-taker"></span>
      <span id="port-fee-spot-maker"></span>
    </div>
    <span id="port-pnl"></span>
    <span id="port-vol"></span>
    <span id="port-total-eq"></span>
    <div id="port-spot-eq-row"><span id="port-spot-eq"></span></div>
    <span id="port-perp-eq"></span>
    <span id="port-upnl"></span>
    <span id="port-vault-eq"></span>
    <span id="port-earn"></span>
    <span id="port-stake"></span>
    <div class="port-menu-wrap">
      <button type="button" id="port-acct-btn" aria-expanded="false"><span id="port-acct-label">All</span></button>
      <div id="port-acct-menu" class="port-menu hidden" hidden>
        <button type="button" data-port-acct="perps"><span>Only Perps</span><span class="port-check" hidden>✓</span></button>
        <button type="button" data-port-acct="all" class="is-on"><span>All</span><span class="port-check">✓</span></button>
      </div>
    </div>
    <select id="port-period"><option value="week">7 Days</option></select>
    <canvas id="port-pnl-chart" width="320" height="160"></canvas>
    <button type="button" data-port-tab="balances" aria-selected="true">Balances</button>
    <div id="port-balances"></div>
    <div id="port-positions" class="hidden"></div>
    <div id="port-outcomes" class="hidden"></div>
    <div id="port-orders" class="hidden"></div>
    <div id="port-twap" class="hidden"></div>
    <div id="port-funding" class="hidden"></div>
    <div id="port-history" class="hidden"></div>
  `;
  document.body.appendChild(dash);
  return {
    dash,
    el: { loading: h("div"), errorBanner: h("div"), dashContent: h("div"), dashUpdated: h("p") },
  };
}

describe("portfolio page structure", () => {
  it("matches the three-card layout with navy links to real Hyperliquid URLs", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const css = readFileSync(join(root, "src/style.css"), "utf8");
    const start = html.indexOf('id="dashboard"');
    const end = html.indexOf('id="trade"');
    const port = html.slice(start, end);
    expect(port).toContain(">Portfolio<");
    expect(port).toContain("14 Day Volume");
    expect(port).toContain("Fees (Taker / Maker)");
    expect(port).toContain('id="port-14d-vol"');
    expect(port).toContain("Spot Equity");
    expect(port).toContain("Perps Equity");
    expect(port).toContain("Vault Equity");
    expect(port).toContain("Earn Balance");
    expect(port).toContain("Staking Account");
    expect(port).toContain("Account Value");
    expect(port).toContain("Perps PNL");
    expect(port).toContain('data-port-chart="account"');
    expect(port).toContain('data-port-chart="pnl"');
    expect(port).toContain('data-port-chart="perpPnl"');
    expect(port).toContain('id="port-acct-btn"');
    expect(port).toContain('id="port-acct-label"');
    expect(port).toContain("Only Perps");
    expect(port).toContain('data-port-acct="perps"');
    expect(port).toContain('data-port-acct="all"');
    expect(port).not.toContain("subAccountUser");
    expect(port).not.toContain("Master");
    expect(port).toContain(">24h<");
    expect(port).toContain(">7D<");
    expect(port).toContain(">30D<");
    expect(port).toContain("All-time");
    expect(port).toContain('id="port-pnl-chart"');
    expect(port).not.toContain("Chart PNL");
    expect(port).toContain('class="port-col"');
    expect(port).toContain('class="port-card port-vol-card"');
    expect(port).toContain('class="port-card port-fee-card"');
    expect(port.indexOf("port-vol-card")).toBeLessThan(port.indexOf("port-fee-card"));
    expect(port.indexOf("14 Day Volume")).toBeGreaterThan(port.indexOf("port-vol-card"));
    expect(port.indexOf("14 Day Volume")).toBeLessThan(port.indexOf("port-fee-card"));
    expect(port.indexOf("Fees (Taker / Maker)")).toBeGreaterThan(port.indexOf("port-fee-card"));
    expect(port).toContain('data-port-tab="balances"');
    expect(port).toContain('data-port-tab="outcomes"');
    expect(port).toContain('id="port-history"');
    expect(port).toContain('id="paste-form"');
    expect(port).toContain('href="' + HL_APP_PORTFOLIO + '"');
    expect(port).toContain('href="' + HL_FEES_DOCS + '"');
    expect(port).toMatch(/class="port-link"[^>]*>View Volume</);
    expect(port).toMatch(/class="port-link"[^>]*>View Fee Schedule</);
    expect(port).not.toMatch(/#ffc107|#FFD700/i);
    expect(css).toMatch(/\.port-link \{[\s\S]*?color: var\(--navy\)/);
    expect(css).toMatch(/\.port-card \{[\s\S]*?border: 1px solid #363737/);
    expect(css).toMatch(/\.port-card \{[\s\S]*?background: #2a2b2b/);
    expect(css).toMatch(/\.port-col \{[\s\S]*?gap: 10px/);
    expect(css).toMatch(/\.port-col \.port-card \{[\s\S]*?flex: none/);
    expect(css).toMatch(/\.port-vol-card \{[\s\S]*?min-height: 148px/);
    expect(css).toMatch(/\.port-page \{[\s\S]*?background: #242525/);
    expect(css).toMatch(/\.port-chart-tab\[aria-selected="true"\] \{[\s\S]*?color: #fff/);
    expect(css).toMatch(/\.port-chart-tab\[aria-selected="true"\] \{[\s\S]*?box-shadow: inset 0 -2px 0 var\(--navy\)/);
    expect(css).toMatch(/#port-tf-menu button\.is-on \{[\s\S]*?background: var\(--navy\)/);
    expect(css).toMatch(/#port-tf-btn\.port-menu-btn \{[\s\S]*?border: 0/);
    expect(css).toMatch(/#port-acct-btn\.port-menu-btn \{[\s\S]*?border: 0/);
    expect(css).toMatch(/#port-acct-menu button\.is-on \{[\s\S]*?background: #323333/);
    expect(css).toMatch(/\.port-check \{[\s\S]*?color: #f6c343/);
    const portCss = css.slice(css.indexOf(".port-page"));
    expect(portCss).not.toContain("#00c853");
    expect(html.split('id="paste-form"').length - 1).toBe(1);
  });
});

describe("portfolio disconnected and live numbers", () => {
  it("shows -- and connect-wallet empty hist when disconnected, never invents PNL", () => {
    const { el } = mount();
    renderDashboard(el, { address: null, data: null, error: null });
    expect(document.getElementById("port-14d-vol").textContent).toBe("--");
    expect(document.getElementById("port-pnl").textContent).toBe("--");
    expect(document.getElementById("port-earn").textContent).toBe("--");
    expect(document.getElementById("port-total-eq").textContent).toBe("--");
    expect(document.getElementById("port-fee-perp-taker").textContent).toBe("--");
    expect(document.getElementById("port-balances").textContent).toContain("Connect wallet to view balances.");
    expect(document.getElementById("port-positions").textContent).toContain("Connect wallet to view positions.");
  });

  it("fills live Info fields and keeps Earn as --; missing PNL stays --", () => {
    const { el } = mount();
    renderDashboard(el, {
      address: "0x999a4b5f268a8fbf33736feff360d462ad248dbf",
      error: null,
      data: {
        perps: {
          time: 1,
          marginSummary: { accountValue: "100" },
          assetPositions: [{ position: { unrealizedPnl: "2.5", szi: "0" } }],
        },
        spot: { balances: [{ coin: "USDC", total: "20" }] },
        staking: { delegated: "3" },
        mids: { HYPE: "2" },
        userFees: {
          dailyUserVlm: [{ userCross: "10", userAdd: "5", exchange: "999" }],
          userCrossRate: "0.00045",
          userAddRate: "0.00015",
          userSpotCrossRate: "0.0004",
          userSpotAddRate: "0.0001",
        },
        portfolio: [["week", { pnlHistory: [], vlm: "50" }]],
        userVaultEquities: [{ equity: "7" }],
        leadingVaults: [],
      },
    });
    expect(document.getElementById("port-14d-vol").textContent).toBe("$15.00");
    expect(document.getElementById("port-vol").textContent).toBe("$50.00");
    expect(document.getElementById("port-pnl").textContent).toBe("--");
    expect(document.getElementById("port-earn").textContent).toBe("--");
    expect(document.getElementById("port-perp-eq").textContent).toBe("$100.00");
    expect(document.getElementById("port-spot-eq").textContent).toBe("$20.00");
    expect(document.getElementById("port-vault-eq").textContent).toBe("$7.00");
    expect(document.getElementById("port-stake").textContent).toBe("$6.00");
    expect(document.getElementById("port-upnl").textContent).toBe("+$2.50");
    expect(document.getElementById("port-fee-perp-taker").textContent).toContain("0.0450%");
  });

  it("draws a white step line on a grey canvas and does not invent an empty series", () => {
    const js = readFileSync(join(root, "src/dashboard.js"), "utf8");
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 40;
    expect(js).toMatch(/ctx\.strokeStyle = "#ffffff"/);
    expect(js).toMatch(/ctx\.fillStyle = "#2a2b2b"/);
    expect(js).toMatch(/ctx\.lineTo\(x, prevY\)/);
    expect(js).not.toMatch(/ctx\.strokeStyle = "#1A2B56"/);
    expect(js).not.toMatch(/\{ t: 0, v: 0 \}/);
    expect(js).toMatch(/axisTicks\(/);
    expect(js).toMatch(/chartSeries\(/);
    expect(js).not.toMatch(/fillAcctMenu/);
    expect(js).not.toMatch(/setPortUserLoader/);
    expect(() => drawPnlChart(canvas, [])).not.toThrow();
    expect(() => drawPnlChart(canvas, [{ t: 1, v: 0 }, { t: 2, v: 0 }])).not.toThrow();
    expect(() => drawPnlChart(canvas, [{ t: 1, v: 1 }, { t: 2, v: 3 }])).not.toThrow();
  });

  it("opens the Accounts menu with Only Perps and All, gold check on All", () => {
    const js = readFileSync(join(root, "src/dashboard.js"), "utf8");
    expect(js).not.toMatch(/fillAcctMenu/);
    expect(js).not.toMatch(/setPortUserLoader/);
    const { el } = mount();
    renderDashboard(el, {
      address: "0x999a4b5f268a8fbf33736feff360d462ad248dbf",
      error: null,
      data: { perps: {}, spot: { balances: [] }, portfolio: [] },
    });
    const btn = document.getElementById("port-acct-btn");
    const menu = document.getElementById("port-acct-menu");
    const rows = [...menu.querySelectorAll("[data-port-acct]")];
    expect(document.getElementById("port-acct-label").textContent).toBe("All");
    expect(rows.map((r) => r.getAttribute("data-port-acct"))).toEqual(["perps", "all"]);
    expect(rows.map((r) => r.querySelector("span").textContent)).toEqual(["Only Perps", "All"]);
    expect(menu.textContent).not.toContain("0x999a");
    expect(menu.classList.contains("hidden")).toBe(true);
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(menu.classList.contains("hidden")).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(rows[1].classList.contains("is-on")).toBe(true);
    expect(rows[1].querySelector(".port-check").hasAttribute("hidden")).toBe(false);
    expect(rows[0].querySelector(".port-check").hasAttribute("hidden")).toBe(true);
  });

  it("switches to Only Perps from live perp windows and hides spot figures", () => {
    const { el } = mount();
    const addr = "0x999a4b5f268a8fbf33736feff360d462ad248dbf";
    const data = {
      perps: { marginSummary: { accountValue: "100" }, assetPositions: [] },
      spot: { balances: [{ coin: "USDC", total: "20" }] },
      staking: { delegated: "3" },
      mids: { HYPE: "2" },
      userFees: {
        userCrossRate: "0.00045",
        userAddRate: "0.00015",
        userSpotCrossRate: "0.0004",
        userSpotAddRate: "0.0001",
      },
      portfolio: [
        ["week", { pnlHistory: [[1, "10"]], vlm: "50", accountValueHistory: [[1, "200"]] }],
        ["perpWeek", { pnlHistory: [[1, "3"]], vlm: "8", accountValueHistory: [[1, "80"]] }],
      ],
      userVaultEquities: [{ equity: "7" }],
    };
    renderDashboard(el, { address: addr, error: null, data });
    expect(document.getElementById("port-pnl").textContent).toBe("+$10.00");
    expect(document.getElementById("port-vol").textContent).toBe("$50.00");
    expect(document.getElementById("port-total-eq").textContent).toBe("$133.00");
    expect(document.getElementById("port-spot-eq-row").classList.contains("hidden")).toBe(false);

    const menu = document.getElementById("port-acct-menu");
    document.getElementById("port-acct-btn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    menu.querySelector('[data-port-acct="perps"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.getElementById("port-acct-label").textContent).toBe("Only Perps");
    expect(menu.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("port-pnl").textContent).toBe("+$3.00");
    expect(document.getElementById("port-vol").textContent).toBe("$8.00");
    expect(document.getElementById("port-total-eq").textContent).toBe("$100.00");
    expect(document.getElementById("port-perp-eq").textContent).toBe("$100.00");
    expect(document.getElementById("port-spot-eq-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("port-fee-spot-row").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("port-vault-eq").textContent).toBe("--");
    expect(document.getElementById("port-stake").textContent).toBe("--");

    menu.querySelector('[data-port-acct="all"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("port-acct-label").textContent).toBe("All");
    expect(document.getElementById("port-total-eq").textContent).toBe("$133.00");
  });
});
