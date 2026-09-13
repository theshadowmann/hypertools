import { hlAddress } from "./order-build.js";

/**
 * Agent keys live in memory and in sessionStorage for this tab only.
 * sessionStorage survives refresh (so Enable trading is not required again)
 * and is cleared when the tab closes. Still wipe on Disconnect.
 *
 * Residual XSS risk on this origin: a script already running here can read
 * sessionStorage. CSP + textContent rendering reduce that risk; they do not
 * make an exploited page safe.
 */
const agents = new Map();
const SESSION_PREFIX = "ht.agent.v1.";
const LEGACY_PREFIX = "ht.agent.";

function sessionKey(user) {
  return SESSION_PREFIX + hlAddress(user);
}

function readSession(user) {
  try {
    const raw = sessionStorage.getItem(sessionKey(user));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.privateKey || !parsed.address) return null;
    return {
      privateKey: String(parsed.privateKey),
      address: hlAddress(parsed.address),
    };
  } catch {
    return null;
  }
}

function writeSession(user, agent) {
  try {
    sessionStorage.setItem(
      sessionKey(user),
      JSON.stringify({
        privateKey: agent.privateKey,
        address: hlAddress(agent.address),
      })
    );
  } catch {
    /* private mode / quota */
  }
}

function clearSession(user) {
  try {
    if (user) sessionStorage.removeItem(sessionKey(user));
  } catch {
    /* ignore */
  }
}

export function rememberAgent(user, agent) {
  if (!user || !agent || !agent.privateKey || !agent.address) return;
  const row = {
    privateKey: agent.privateKey,
    address: hlAddress(agent.address),
  };
  agents.set(hlAddress(user), row);
  writeSession(user, row);
}

export function getAgent(user) {
  if (!user) return null;
  const key = hlAddress(user);
  const mem = agents.get(key);
  if (mem) return mem;
  const fromSession = readSession(user);
  if (fromSession) {
    agents.set(key, fromSession);
    return fromSession;
  }
  return null;
}

export function wipeAgents() {
  const users = Array.from(agents.keys());
  agents.forEach((a) => {
    if (a) a.privateKey = "";
  });
  agents.clear();
  users.forEach((u) => clearSession(u));
  // Also clear any session keys we can see
  try {
    const doomed = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(SESSION_PREFIX) === 0) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  stripLegacyStorage();
}

function stripLegacyStorage() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(LEGACY_PREFIX) === 0) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* private mode */
  }
  try {
    const doomed = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(LEGACY_PREFIX) === 0 && k.indexOf(SESSION_PREFIX) !== 0) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* private mode */
  }
}

stripLegacyStorage();
