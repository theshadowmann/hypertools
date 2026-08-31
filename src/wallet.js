import { ADDR_RE } from "./api.js";

export function labelInjected(provider) {
  if (!provider) return "Injected wallet";
  if (provider.isRabby) return "Rabby";
  if (provider.isOkxWallet) return "OKX Wallet";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isPhantom) return "Phantom";
  if (provider.isBraveWallet) return "Brave Wallet";
  if (provider.isMetaMask) return "MetaMask";
  return "Injected wallet";
}

export function createWalletDiscovery(onChange) {
  const discovered = {};

  function list() {
    return Object.keys(discovered)
      .map((id) => discovered[id])
      .sort((a, b) => String(a.info.name).localeCompare(String(b.info.name)));
  }

  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = event.detail || {};
    const info = detail.info || {};
    if (!info.uuid || !detail.provider) return;
    discovered[info.uuid] = { info, provider: detail.provider };
    onChange(list());
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  setTimeout(() => onChange(list()), 250);
  return { list, discovered };
}

export function walletKind(entry) {
  const info = (entry && entry.info) || {};
  const provider = (entry && entry.provider) || {};
  const name = String(info.name || "").toLowerCase();
  const rdns = String(info.rdns || "").toLowerCase();
  if (provider.isRabby || name.indexOf("rabby") !== -1 || rdns.indexOf("rabby") !== -1) return "rabby";
  if (provider.isMetaMask || name.indexOf("metamask") !== -1 || rdns.indexOf("metamask") !== -1) {
    return "metamask";
  }
  return null;
}

export function walletTargets(discoveredList) {
  const seen = { metamask: false, rabby: false };
  const picked = [];
  (discoveredList || []).forEach((entry) => {
    const kind = walletKind(entry);
    if (!kind || seen[kind]) return;
    seen[kind] = true;
    picked.push({
      kind,
      name: kind === "rabby" ? "Rabby" : "MetaMask",
      provider: entry.provider,
    });
  });
  if (!picked.length && window.ethereum) {
    const provider = window.ethereum;
    if (provider.providers && provider.providers.length) {
      let mm = null;
      let rabby = null;
      provider.providers.forEach((p) => {
        if (p && p.isRabby) rabby = p;
        else if (p && p.isMetaMask && !p.isRabby) mm = p;
      });
      if (mm) picked.push({ kind: "metamask", name: "MetaMask", provider: mm });
      if (rabby) picked.push({ kind: "rabby", name: "Rabby", provider: rabby });
    }
    if (!picked.length) {
      const label = labelInjected(provider);
      if (provider.isRabby) picked.push({ kind: "rabby", name: "Rabby", provider });
      else if (provider.isMetaMask) picked.push({ kind: "metamask", name: "MetaMask", provider });
      else picked.push({ kind: "injected", name: label, provider });
    }
  }
  return picked;
}

export async function requestAccounts(provider) {
  if (!provider || typeof provider.request !== "function") {
    throw new Error("No wallet provider.");
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts || !accounts.length) throw new Error("Wallet returned no account.");
  const addr = String(accounts[0] || "").trim();
  if (!ADDR_RE.test(addr)) throw new Error("Wallet returned an invalid address.");
  return addr;
}

export function attachWalletListeners(provider, { onAccounts, onDisconnect }) {
  if (!provider || typeof provider.on !== "function") return () => {};
  const accountsHandler = (accounts) => {
    if (!accounts || !accounts.length) {
      onDisconnect();
      return;
    }
    onAccounts(accounts[0]);
  };
  const disconnectHandler = () => onDisconnect();
  provider.on("accountsChanged", accountsHandler);
  try {
    provider.on("disconnect", disconnectHandler);
  } catch {
    /* some wallets omit this */
  }
  return () => {
    try {
      if (typeof provider.removeListener === "function") {
        provider.removeListener("accountsChanged", accountsHandler);
        provider.removeListener("disconnect", disconnectHandler);
      } else if (typeof provider.off === "function") {
        provider.off("accountsChanged", accountsHandler);
        provider.off("disconnect", disconnectHandler);
      }
    } catch {
      /* ignore */
    }
  };
}
