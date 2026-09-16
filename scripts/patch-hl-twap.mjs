/**
 * @nktkas/hyperliquid 0.33.3 still validates TWAP duration with max 1440 (24h).
 * Hyperliquid mainnet allows 5m–7d (10080). Patch until the SDK catches up.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "node_modules/@nktkas/hyperliquid/esm/api/exchange/_methods/twapOrder.js",
  "node_modules/@nktkas/hyperliquid/esm/api/exchange/_methods/twapOrder.d.ts",
];

let changed = 0;
for (const rel of targets) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    console.warn("skip missing", rel);
    continue;
  }
  const before = readFileSync(path, "utf8");
  const after = before
    .replaceAll("maxValue(1440)", "maxValue(10080)")
    .replaceAll("MaxValueAction<number, 1440,", "MaxValueAction<number, 10080,");
  if (after === before) {
    if (before.includes("maxValue(10080)") || before.includes("MaxValueAction<number, 10080,")) {
      console.log("ok", rel);
    } else {
      console.warn("pattern not found", rel);
    }
    continue;
  }
  writeFileSync(path, after);
  changed += 1;
  console.log("patched", rel);
}
if (changed) console.log("HL TWAP max duration patched to 7d (10080 min).");
