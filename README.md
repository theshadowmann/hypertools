# HyperTools

Hyperliquid trading terminal: live perp chart, L2 order book, and market/limit orders from a connected wallet. Account overview for balances, positions, and staking.

Live: [https://www.hypertools.app](https://www.hypertools.app)

## What it does

- **Trade** — market picker (BTC default), candlestick chart, live order book, order ticket (market / limit / stop / TWAP), open orders with cancel, recent fills.
- **Account** — equity, withdrawable, margin used, uPnL, perp positions (entry, mark, liq, leverage), spot balances, HYPE staking with validator names.
- **Wallet** — EIP-6963 (MetaMask / Rabby) to place and cancel orders. Paste a `0x` address to load an account; orders still need a connected wallet.

Orders go to `https://api.hyperliquid.xyz/exchange` (mainnet). Chart, book, and account data come from the Info API and `wss://api.hyperliquid.xyz/ws`. Signing is in the browser. First trade (or **Enable trading**) approves a local agent key and a builder fee; later orders are signed by the agent. Agent keys stay in `localStorage` and are not sent to a server.

Builder on every `order` action: `0x999a4b5f268a8fbf33736feff360d462ad248dbf` (`f` = 10 tenths of a bp = 1 bp).

## Develop

```bash
npm install
npm run dev
```

## Static build (Azure Static Web Apps)

```bash
npm install
npm run build
```

Output is `dist/` with `index.html` at the site root and `staticwebapp.config.json` copied in. Deploy that folder. Client-side routes `/` (account) and `/trade` fall back to `index.html`.

```bash
npm test
```
