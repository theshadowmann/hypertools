import { defineConfig } from "vite";
import swa from "./staticwebapp.config.json" with { type: "json" };

const csp = swa.globalHeaders["Content-Security-Policy"];
const tvEmbedRoute = swa.routes.find((r) => r.route === "/embed-widget/*");
const tvEmbedCsp = tvEmbedRoute.headers["Content-Security-Policy"];

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
      server.middlewares.use(patch);
    },
    configurePreviewServer(server) {
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
    port: 4173,
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
