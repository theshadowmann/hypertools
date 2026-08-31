import { defineConfig } from "vite";

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
  },
  preview: {
    port: 4173,
    host: true,
  },
  test: {
    environment: "node",
  },
});
