import { createWalletClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { getAgent, rememberAgent } from "./agent-store.js";
import { HL_API } from "./hosts.js";
import { DEFAULT_MAX_SLIPPAGE, TWAP_MAX_MINUTES, TWAP_MIN_MINUTES } from "./ticket-math.js";
import {
  AGENT_NAME,
  BUILDER_ADDRESS,
  BUILDER_FEE_TENTHS,
  BUILDER_MAX_FEE_RATE,
  assertCanTrade,
  buildOrderPayload,
  buildOrderWire,
  explainExchangeError,
  hlAddress,
  orderSucceeded,
  sealOrderPayload,
  slippagePrice,
  userMessage,
} from "./order-build.js";

const transport = new HttpTransport({ isTestnet: false, apiUrl: HL_API });
const info = new InfoClient({ transport });

function walletClient(provider, address) {
  return createWalletClient({
    account: address,
    transport: custom(provider),
  });
}

async function agentStillValid(user, agent) {
  if (!agent) return false;
  try {
    const extras = await info.extraAgents({ user });
    if (!Array.isArray(extras)) return false;
    const now = Date.now();
    return extras.some((a) => {
      if (!a || hlAddress(a.address) !== hlAddress(agent.address)) return false;
      if (a.validUntil == null) return true;
      return Number(a.validUntil) > now + 60_000;
    });
  } catch {
    return false;
  }
}

export async function tradingStatus(user) {
  const [maxFee, extras] = await Promise.all([
    info.maxBuilderFee({ user, builder: BUILDER_ADDRESS }).catch(() => 0),
    info.extraAgents({ user }).catch(() => []),
  ]);
  const stored = getAgent(user);
  const feeOk = Number(maxFee) >= BUILDER_FEE_TENTHS;
  const agentOk = stored
    ? (extras || []).some(
        (a) =>
          a &&
          hlAddress(a.address) === hlAddress(stored.address) &&
          (a.validUntil == null || Number(a.validUntil) > Date.now() + 60_000)
      )
    : false;
  return { feeOk, agentOk, maxFee: Number(maxFee) || 0, stored };
}

/**
 * Explicit user click only. Approves builder fee + agent via official EIP-712
 * (approveBuilderFee / approveAgent). The agent private key is never logged.
 */
export async function enableTrading({ provider, address, onStatus }) {
  assertCanTrade("wallet");
  if (!provider) throw new Error("Connect a wallet to trade.");
  const user = address;
  const master = new ExchangeClient({
    transport,
    wallet: walletClient(provider, user),
  });

  const status = await tradingStatus(user);
  if (!status.feeOk) {
    onStatus && onStatus("Approve the builder fee in your wallet…");
    await master.approveBuilderFee({
      builder: BUILDER_ADDRESS,
      maxFeeRate: BUILDER_MAX_FEE_RATE,
    });
  }

  let agent = status.stored;
  const valid = agent ? await agentStillValid(user, agent) : false;
  if (!valid) {
    const privateKey = generatePrivateKey();
    const acct = privateKeyToAccount(privateKey);
    onStatus && onStatus("Approve the HyperTools trading agent in your wallet…");
    await master.approveAgent({
      agentAddress: acct.address,
      agentName: AGENT_NAME,
    });
    agent = { privateKey, address: acct.address };
    rememberAgent(user, agent);
  }

  onStatus && onStatus("Trading enabled.");
  return agent;
}

function agentExchange(agent) {
  if (!agent || !agent.privateKey) throw new Error("Enable trading first.");
  return new ExchangeClient({
    transport,
    wallet: privateKeyToAccount(agent.privateKey),
  });
}

async function requireReadyAgent(address) {
  const stored = getAgent(address);
  if (!stored || !stored.privateKey) {
    throw new Error("Enable trading first.");
  }
  const ready = await tradingStatus(address);
  if (!ready.feeOk || !ready.agentOk) {
    throw new Error("Enable trading first.");
  }
  return stored;
}

export async function placePerpOrder({
  source,
  address,
  market,
  side,
  size,
  price,
  mid,
  type,
  tif,
  reduceOnly,
  triggerPx,
  tpsl,
  triggerIsMarket,
  maxSlippage,
  extraOrders,
  grouping,
  asset,
  onStatus,
}) {
  assertCanTrade(source);
  const agent = await requireReadyAgent(address);

  const isBuy = side === "buy";
  let px = price;
  if (type === "market") {
    px = slippagePrice(mid, isBuy, Number(maxSlippage) > 0 ? Number(maxSlippage) : DEFAULT_MAX_SLIPPAGE);
    onStatus && onStatus("Signing market order…");
  } else if (type === "stop") {
    onStatus && onStatus("Signing stop order…");
  } else {
    onStatus && onStatus("Signing limit order…");
  }

  const wire = buildOrderWire({
    asset: Number.isInteger(Number(asset)) ? Number(asset) : market.asset,
    isBuy,
    size,
    price: px,
    reduceOnly,
    type,
    tif,
    szDecimals: market.szDecimals,
    triggerPx,
    tpsl,
    triggerIsMarket,
  });
  const payload = sealOrderPayload(
    buildOrderPayload(extraOrders && extraOrders.length ? [wire].concat(extraOrders) : wire, grouping || "na")
  );
  const exch = agentExchange(agent);
  const result = await exch.order(payload);
  if (result == null) throw new Error("No response from Hyperliquid.");
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  if (!orderSucceeded(result) && result.status !== "ok") {
    throw new Error("Hyperliquid did not accept the order.");
  }
  return result;
}

export async function placeTwapOrder({
  source,
  address,
  market,
  side,
  size,
  reduceOnly,
  minutes,
  randomize,
  onStatus,
}) {
  assertCanTrade(source);
  const agent = await requireReadyAgent(address);
  const m = Math.max(TWAP_MIN_MINUTES, Math.min(TWAP_MAX_MINUTES, Math.round(Number(minutes) || 30)));
  onStatus && onStatus("Signing TWAP order…");
  const exch = agentExchange(agent);
  const result = await exch.twapOrder({
    twap: {
      a: market.asset,
      b: side === "buy",
      s: String(size),
      r: !!reduceOnly,
      m,
      t: !!randomize,
    },
  });
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  return result;
}

export async function cancelOrders({ source, address, cancels, onStatus }) {
  assertCanTrade(source);
  const agent = await requireReadyAgent(address);
  onStatus && onStatus("Signing cancel…");
  const exch = agentExchange(agent);
  const result = await exch.cancel({
    cancels: cancels.map((c) => ({ a: c.asset, o: c.oid })),
  });
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  return result;
}

export async function cancelTwap({ source, address, asset, twapId, onStatus }) {
  assertCanTrade(source);
  const agent = await requireReadyAgent(address);
  onStatus && onStatus("Signing TWAP cancel…");
  const exch = agentExchange(agent);
  const result = await exch.twapCancel({ a: asset, t: twapId });
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  return result;
}

export async function placeScaleOrders({ source, address, orders, onStatus }) {
  assertCanTrade(source);
  const agent = await requireReadyAgent(address);
  onStatus && onStatus("Signing scale orders…");
  const payload = sealOrderPayload(buildOrderPayload(orders, "na"));
  const result = await agentExchange(agent).order(payload);
  if (result == null) throw new Error("No response from Hyperliquid.");
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  if (!orderSucceeded(result) && result.status !== "ok") {
    throw new Error("Hyperliquid did not accept the order.");
  }
  return result;
}

export async function setLeverage({ source, address, asset, isCross, leverage, onStatus }) {
  assertCanTrade(source);
  const agent = await requireReadyAgent(address);
  onStatus && onStatus("Updating leverage…");
  const result = await agentExchange(agent).updateLeverage({
    asset,
    isCross: !!isCross,
    leverage: Math.max(1, Math.round(Number(leverage) || 1)),
  });
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  return result;
}

export { userMessage };
