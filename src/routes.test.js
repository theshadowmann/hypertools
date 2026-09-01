import { describe, expect, it } from "vitest";
import { deskUrl, isTvChartEmbedPath, viewFromLocation } from "./routes.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("viewFromLocation", () => {
  it("keeps /trade and /outcome on the terminal, /portfolio on its own page", () => {
    expect(viewFromLocation("/trade", "")).toBe("trade");
    expect(viewFromLocation("/outcome", "")).toBe("outcome");
    expect(viewFromLocation("/portfolio", "")).toBe("portfolio");
    expect(viewFromLocation("/", "")).toBe("portfolio");
    expect(deskUrl("trade")).toBe("/trade");
    expect(deskUrl("outcome")).toBe("/outcome");
    expect(deskUrl("portfolio")).toBe("/portfolio");
  });

  it("does not render Portfolio inside the TradingView embed iframe path", () => {
    expect(viewFromLocation("/embed-widget/advanced-chart", "")).toBe("embed");
    expect(viewFromLocation("/embed-widget/advanced-chart/", "")).toBe("embed");
    expect(viewFromLocation("/embed-widget/advanced-chart/?overrides=%7B%7D", "")).toBe("embed");
    expect(viewFromLocation("/embed-widget/advanced-chart/index.html", "")).toBe("embed");
    expect(isTvChartEmbedPath("/embed-widget/advanced-chart/?overrides=%7B%7D#cfg")).toBe(true);
    expect(isTvChartEmbedPath("/trade")).toBe(false);
    const html = readFileSync(join(root, "index.html"), "utf8");
    const dash = html.indexOf('id="dashboard"');
    const trade = html.indexOf('id="trade"');
    expect(dash).toBeGreaterThan(-1);
    expect(trade).toBeGreaterThan(dash);
    const dashBlock = html.slice(dash, trade);
    const tradeEnd = html.indexOf("</section>", trade);
    const tradeBlock = html.slice(trade, tradeEnd);
    expect(dashBlock).toContain("Portfolio");
    expect(dashBlock).toContain("Paste an address");
    expect(html).toMatch(/id="dashboard"[^>]*class="hidden port-page"/);
    expect(tradeBlock).not.toContain("Paste an address");
    expect(tradeBlock).not.toContain("14 Day Volume");
    expect(tradeBlock).not.toContain('id="dashboard"');
    expect(tradeBlock).toContain('id="chart"');
    expect(tradeBlock).toContain('class="trade-chart"');
  });
});
