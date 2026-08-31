import { createWalletClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
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
  slippagePrice,
} from "./order-build.js";

const transport = new HttpTransport({ isTestnet: false });
const info = new InfoClient({ transport });

const AGENT_STORE_PREFIX = "ht.agent.";

function agentKey(user) {
  return AGENT_STORE_PREFIX + hlAddress(user);
}

export function loadStoredAgent(user) {
  try {
    const raw = localStorage.getItem(agentKey(user));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.privateKey || !parsed.address) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredAgent(user, agent) {
  localStorage.setItem(
    agentKey(user),
    JSON.stringify({
      privateKey: agent.privateKey,
      address: hlAddress(agent.address),
      name: AGENT_NAME,
      savedAt: Date.now(),
    })
  );
}

function walletClient(provider, address) {
  return createWalletClient({
    account: address,
    transport: custom(provider),
  });
}

function userMessage(err) {
  if (!err) return "Request failed.";
  if (err.code === 4001 || err.code === "ACTION_REJECTED") return "Wallet rejected the signature.";
  const fromApi = explainExchangeError(err.response);
  if (fromApi) return fromApi;
  const msg = err.message || String(err);
  if (/user rejected|denied|rejected the request/i.test(msg)) return "Wallet rejected the signature.";
  return msg;
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
  const stored = loadStoredAgent(user);
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
 * One-time setup: approve builder fee + agent. Master wallet signs both EIP-712
 * messages. The agent private key never leaves this browser (memory / localStorage).
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
    saveStoredAgent(user, agent);
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

export async function placePerpOrder({
  source,
  provider,
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
  onStatus,
}) {
  assertCanTrade(source);
  let agent = loadStoredAgent(address);
  const ready = await tradingStatus(address);
  if (!ready.feeOk || !ready.agentOk) {
    agent = await enableTrading({ provider, address, onStatus });
  } else {
    agent = ready.stored;
  }

  const isBuy = side === "buy";
  let px = price;
  if (type === "market") {
    px = slippagePrice(mid, isBuy, 0.05);
    onStatus && onStatus("Signing market order…");
  } else if (type === "stop") {
    onStatus && onStatus("Signing stop order…");
  } else {
    onStatus && onStatus("Signing limit order…");
  }

  const wire = buildOrderWire({
    asset: market.asset,
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
  const payload = buildOrderPayload(wire);
  const exch = agentExchange(agent);
  const result = await exch.order(payload);
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  if (!orderSucceeded(result) && result.status !== "ok") {
    throw new Error("Hyperliquid did not accept the order.");
  }
  return result;
}

export async function placeTwapOrder({
  source,
  provider,
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
  let agent = loadStoredAgent(address);
  const ready = await tradingStatus(address);
  if (!ready.feeOk || !ready.agentOk) {
    agent = await enableTrading({ provider, address, onStatus });
  } else {
    agent = ready.stored;
  }
  const m = Math.max(5, Math.round(Number(minutes) || 30));
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

export async function cancelOrders({ source, provider, address, cancels, onStatus }) {
  assertCanTrade(source);
  let agent = loadStoredAgent(address);
  const ready = await tradingStatus(address);
  if (!ready.feeOk || !ready.agentOk) {
    agent = await enableTrading({ provider, address, onStatus });
  } else {
    agent = ready.stored;
  }
  onStatus && onStatus("Signing cancel…");
  const exch = agentExchange(agent);
  const result = await exch.cancel({
    cancels: cancels.map((c) => ({ a: c.asset, o: c.oid })),
  });
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  return result;
}

export async function cancelTwap({ source, provider, address, asset, twapId, onStatus }) {
  assertCanTrade(source);
  let agent = loadStoredAgent(address);
  const ready = await tradingStatus(address);
  if (!ready.feeOk || !ready.agentOk) {
    agent = await enableTrading({ provider, address, onStatus });
  } else {
    agent = ready.stored;
  }
  onStatus && onStatus("Signing TWAP cancel…");
  const exch = agentExchange(agent);
  const result = await exch.twapCancel({ a: asset, t: twapId });
  const err = explainExchangeError(result);
  if (err) throw new Error(err);
  return result;
}

export { userMessage };
