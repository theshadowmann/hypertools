import { defineConfig } from "vite";
import swa from "./staticwebapp.config.json" with { type: "json" };

const csp = swa.globalHeaders["Content-Security-Policy"];

export default defineConfig({
  root: ".",
  publicDir: "public",
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
