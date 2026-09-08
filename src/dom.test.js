/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { drawPnlChart, renderDashboard } from "./dashboard.js";
import { h } from "./dom.js";

const XSS = '<img src="x" onerror="alert(1)">';

beforeEach(() => {
  document.body.innerHTML = "";
});

function mountPort() {
  const dash = document.createElement("div");
  dash.id = "dashboard";
  dash.innerHTML = `
    <div id="port-paste-wrap"></div>
    <p id="port-14d-vol">xx</p>
    <span id="port-fee-perp-taker">xx</span>
    <span id="port-fee-perp-maker">xx</span>
    <span id="port-fee-spot-taker">xx</span>
    <span id="port-fee-spot-maker">xx</span>
    <span id="port-pnl">xx</span>
    <span id="port-vol">xx</span>
    <span id="port-total-eq">xx</span>
    <span id="port-spot-eq">xx</span>
    <span id="port-perp-eq">xx</span>
    <span id="port-upnl">xx</span>
    <span id="port-vault-eq">xx</span>
    <span id="port-earn">xx</span>
    <span id="port-stake">xx</span>
    <select id="port-period"><option value="week">7 Days</option><option value="month">30 Days</option><option value="allTime">All Time</option></select>
    <canvas id="port-pnl-chart" width="320" height="160"></canvas>
    <div id="port-balances"></div>
    <div id="port-positions"></div>
    <div id="port-outcomes"></div>
    <div id="port-orders"></div>
    <div id="port-twap"></div>
    <div id="port-funding"></div>
    <div id="port-history"></div>
  `;
  document.body.appendChild(dash);
  const el = {
    loading: h("div"),
    errorBanner: h("div"),
    dashContent: h("div"),
    dashUpdated: h("p"),
  };
  return { dash, el };
}

describe("untrusted strings", () => {
  it("h() puts markup in a text node, not HTML", () => {
    const node = h("p", null, XSS);
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toBe(XSS);
    expect(node.innerHTML.includes("<img")).toBe(false);
  });

  it("dashboard hist tables do not inject API coin strings as HTML", () => {
    const { el } = mountPort();
    renderDashboard(el, {
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      error: null,
      data: {
        perps: {
          marginSummary: { accountValue: "1", totalMarginUsed: "0" },
          withdrawable: "1",
          assetPositions: [
            {
              position: {
                coin: XSS,
                szi: "1",
                entryPx: "1",
                leverage: { value: 2, type: "cross" },
                unrealizedPnl: "0",
                returnOnEquity: "0",
                liquidationPx: null,
                positionValue: "1",
              },
            },
          ],
        },
        spot: { balances: [{ coin: XSS, total: "1", hold: "0" }] },
        staking: {},
        mids: {},
        openOrders: [{ coin: XSS, side: "B", origSz: "1", limitPx: "1", oid: 1, timestamp: 1 }],
      },
    });
    const pos = document.getElementById("port-positions");
    const bal = document.getElementById("port-balances");
    expect(pos.querySelector("img")).toBeNull();
    expect(bal.querySelector("img")).toBeNull();
    expect(pos.textContent).toContain(XSS);
    expect(bal.textContent).toContain(XSS);
    expect(pos.innerHTML.includes("<img")).toBe(false);
  });
});
