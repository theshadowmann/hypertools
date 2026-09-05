import { hlAddress } from "./order-build.js";

/**
 * Agent private keys stay in process memory only.
 *
 * Residual XSS risk: a script already running on this origin can read this Map
 * until wipeAgents() runs. CSP (script-src 'self') and textContent rendering
 * exist to make that XSS harder; they do not make an exploited page safe.
 */
const agents = new Map();

const LEGACY_PREFIX = "ht.agent.";

export function rememberAgent(user, agent) {
  if (!user || !agent || !agent.privateKey || !agent.address) return;
  agents.set(hlAddress(user), {
    privateKey: agent.privateKey,
    address: hlAddress(agent.address),
  });
}

export function getAgent(user) {
  if (!user) return null;
  return agents.get(hlAddress(user)) || null;
}

export function wipeAgents() {
  agents.forEach((a) => {
    if (a) a.privateKey = "";
  });
  agents.clear();
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
      if (k && k.indexOf(LEGACY_PREFIX) === 0) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* private mode */
  }
}

stripLegacyStorage();
