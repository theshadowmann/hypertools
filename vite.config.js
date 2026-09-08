import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import swa from "./staticwebapp.config.json" with { type: "json" };
import { isTvChartEmbedPath } from "./src/routes.js";

const csp = swa.globalHeaders["Content-Security-Policy"];
const tvEmbedRoute = swa.routes.find((r) => r.route === "/embed-widget/*");
const tvEmbedCsp = tvEmbedRoute.headers["Content-Security-Policy"];
const TV_EMBED_REL = "embed-widget/advanced-chart/index.html";

function resolveTvEmbedFile(root) {
  const dist = join(root, "dist", TV_EMBED_REL);
  const pub = join(root, "public", TV_EMBED_REL);
  if (existsSync(pub)) return pub;
  if (existsSync(dist)) return dist;
  return null;
}

function sendTvEmbed(req, res, next, root) {
  if (!isTvChartEmbedPath(req.url || "")) return next();
  const file = resolveTvEmbedFile(root);
  if (!file) return next();
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Security-Policy", tvEmbedCsp);
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.end(readFileSync(file));
}

function tvEmbedHeaders() {
  function patch(req, res, next) {
    if (req.url && (req.url.startsWith("/embed-widget/") || req.url.startsWith("/tv-embed.html"))) {
      const orig = res.setHeader.bind(res);
      res.setHeader = (name, value) => {
        const key = String(name).toLowerCase();
        if (key === "content-security-policy") value = tvEmbedCsp;
        if (key === "x-frame-options") value = "SAMEORIGIN";
        return orig(name, value);
      };
      res.setHeader("Content-Security-Policy", tvEmbedCsp);
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
    }
    next();
  }
  return {
    name: "tv-embed-headers",
    configureServer(server) {
      const root = server.config.root || process.cwd();
      server.middlewares.use((req, res, next) => sendTvEmbed(req, res, next, root));
      server.middlewares.use(patch);
    },
    configurePreviewServer(server) {
      const root = server.config.root || process.cwd();
      server.middlewares.use((req, res, next) => sendTvEmbed(req, res, next, root));
      server.middlewares.use(patch);
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [tvEmbedHeaders()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    target: "es2020",
  },
  server: {
    port: 5173,
    strictPort: false,
    host: true,
    headers: { "Content-Security-Policy": csp },
  },
  preview: {
    port: 4173,
    host: true,
    headers: { "Content-Security-Policy": csp },
  },
  test: {
    environment: "node",
  },
});
