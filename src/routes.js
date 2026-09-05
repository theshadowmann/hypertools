function pathOnly(pathname) {
  return String(pathname || "/").split("?")[0].split("#")[0];
}

function normalizePath(pathname) {
  return pathOnly(pathname).replace(/\/+$/, "") || "/";
}

/** True for the same-origin TradingView snapshot (with or without query/hash). */
export function isTvChartEmbedPath(pathname) {
  const path = normalizePath(pathname);
  return path === "/embed-widget/advanced-chart" || path === "/embed-widget/advanced-chart/index.html";
}

/** True for any `/embed-widget` URL. The SPA must not render here. */
export function isTvEmbedPath(pathname) {
  const path = normalizePath(pathname);
  return path === "/embed-widget" || path.startsWith("/embed-widget/");
}

/** Route the SPA. Unknown paths must not steal the TradingView embed iframe. */
export function viewFromLocation(pathname, hash) {
  const path = normalizePath(pathname);
  const h = hash || "";
  if (isTvEmbedPath(path)) return "embed";
  if (path === "/trade" || h === "#trade" || h === "#/trade") return "trade";
  if (path === "/outcome" || h === "#outcome" || h === "#/outcome") return "outcome";
  if (path === "/portfolio" || h === "#portfolio" || h === "#/portfolio") return "portfolio";
  if (path === "/") return "portfolio";
  return "portfolio";
}

export function deskUrl(view) {
  if (view === "trade") return "/trade";
  if (view === "outcome") return "/outcome";
  return "/portfolio";
}
