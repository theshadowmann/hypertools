#!/usr/bin/env node
/**
 * Snapshot the official TradingView Advanced Chart page and inject Deep Teal
 * chrome CSS. The public iframe ignores toolbar_bg; same-origin paint of
 * layout__area--top/left is what actually colors the drawing and Indicators bars.
 *
 * Destination path must stay `/embed-widget/advanced-chart/` so TV's onWidget()
 * path check still treats this as an Advanced Chart embed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TV_CHROME_CSS, TV_WIDGET_PAGE } from "../src/tv-chart.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "public/embed-widget/advanced-chart");
const dest = join(destDir, "index.html");

function injectChrome(html) {
  let out = html.replace(/\snonce="[^"]*"/g, "");
  out = out.replace(/<style id="ht-tv-chrome">[\s\S]*?<\/style>/g, "");
  const tag = `<style id="ht-tv-chrome">${TV_CHROME_CSS}</style>`;
  if (out.includes("<head>")) out = out.replace("<head>", `<head>${tag}`);
  else out = tag + out;
  return out;
}

let html;
try {
  const res = await fetch(TV_WIDGET_PAGE, {
    headers: { "User-Agent": "Mozilla/5.0 HyperToolsTVEmbed" },
  });
  if (!res.ok) throw new Error(`TV widget snapshot failed: ${res.status} ${res.statusText}`);
  html = await res.text();
} catch (err) {
  if (!existsSync(dest)) throw err;
  html = readFileSync(dest, "utf8");
  console.warn("TV snapshot fetch failed, refreshing CSS in cached copy:", err && err.message);
}

mkdirSync(destDir, { recursive: true });
writeFileSync(dest, injectChrome(html));
console.log("wrote", dest, html.length, "bytes");
