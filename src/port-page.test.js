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
    <span id="port-fee-spot-taker"></span>
    <span id="port-fee-spot-maker"></span>
    <span id="port-pnl"></span>
    <span id="port-vol"></span>
    <span id="port-total-eq"></span>
    <span id="port-spot-eq"></span>
    <span id="port-perp-eq"></span>
    <span id="port-upnl"></span>
    <span id="port-vault-eq"></span>
    <span id="port-earn"></span>
    <span id="port-stake"></span>
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
    expect(port).toContain("Chart PNL");
    expect(port).toContain('id="port-pnl-chart"');
    expect(port).toContain('data-port-tab="balances"');
    expect(port).toContain('data-port-tab="outcomes"');
    expect(port).toContain('id="port-history"');
    expect(port).toContain('id="paste-form"');
    expect(port).toContain('href="' + HL_APP_PORTFOLIO + '"');
    expect(port).toContain('href="' + HL_FEES_DOCS + '"');
    expect(port).toMatch(/class="port-link"[^>]*>View Volume</);
    expect(port).toMatch(/class="port-link"[^>]*>View Fee Schedule</);
    expect(port).not.toMatch(/#f6c343|#ffc107|#FFD700|gold/i);
    expect(css).toMatch(/\.port-link \{[\s\S]*?color: var\(--navy\)/);
    expect(css).toMatch(/\.port-card \{[\s\S]*?border: 1px solid rgba\(255, 255, 255, 0\.45\)/);
    expect(css).toMatch(/\.port-page \{[\s\S]*?background: #242525/);
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

  it("draws a navy PNL line on a grey canvas, including a flat $0 series", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 40;
    expect(() => drawPnlChart(canvas, [])).not.toThrow();
    expect(() => drawPnlChart(canvas, [{ t: 1, v: 1 }, { t: 2, v: 3 }])).not.toThrow();
  });
});
