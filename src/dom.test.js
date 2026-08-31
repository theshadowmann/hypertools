/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { renderDashboard } from "./dashboard.js";
import { h } from "./dom.js";

const XSS = '<img src="x" onerror="alert(1)">';

function mount() {
  const el = {
    loading: h("div"),
    errorBanner: h("div"),
    dashContent: h("div"),
    dashUpdated: h("p"),
    overview: h("div"),
    perpsRoot: h("div"),
    perpsCount: h("p"),
    spotRoot: h("div"),
    spotCount: h("p"),
    stakingRoot: h("div"),
  };
  document.body.appendChild(el.perpsRoot);
  document.body.appendChild(el.spotRoot);
  document.body.appendChild(el.stakingRoot);
  document.body.appendChild(el.overview);
  return el;
}

describe("untrusted strings", () => {
  it("h() puts markup in a text node, not HTML", () => {
    const node = h("p", null, XSS);
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toBe(XSS);
    expect(node.innerHTML.includes("<img")).toBe(false);
  });

  it("dashboard does not inject API coin/validator strings as HTML", () => {
    const el = mount();
    renderDashboard(el, {
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
        delegations: [{ validator: XSS, amount: "1" }],
        validatorNames: {},
        mids: {},
      },
    });
    expect(el.perpsRoot.querySelector("img")).toBeNull();
    expect(el.spotRoot.querySelector("img")).toBeNull();
    expect(el.stakingRoot.querySelector("img")).toBeNull();
    expect(el.perpsRoot.textContent).toContain(XSS);
    expect(el.spotRoot.textContent).toContain(XSS);
    expect(el.stakingRoot.textContent).toContain(XSS);
  });
});
