const ALLOWED = {
  eth_requestAccounts: true,
  eth_accounts: true,
  eth_chainId: true,
  eth_signTypedData_v4: true,
  eth_signTypedData: true,
};

const HL_TYPED_DOMAINS = {
  Exchange: true,
  HyperliquidSignTransaction: true,
};

export function assertHlTypedData(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("Refusing to sign malformed typed data.");
    }
  }
  const name = data && data.domain && data.domain.name;
  if (!HL_TYPED_DOMAINS[name]) {
    throw new Error("Refusing to sign unexpected typed data.");
  }
}

export function guardProvider(provider) {
  if (!provider || typeof provider.request !== "function") {
    throw new Error("No wallet provider.");
  }
  return {
    request: function (args) {
      const method = args && args.method;
      if (!ALLOWED[method]) {
        return Promise.reject(new Error("Wallet method not allowed."));
      }
      if (method === "eth_signTypedData_v4" || method === "eth_signTypedData") {
        const params = args.params || [];
        const payload = params.length > 1 ? params[1] : params[0];
        try {
          assertHlTypedData(payload);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      return provider.request(args);
    },
    on: typeof provider.on === "function" ? provider.on.bind(provider) : undefined,
    removeListener:
      typeof provider.removeListener === "function" ? provider.removeListener.bind(provider) : undefined,
    off: typeof provider.off === "function" ? provider.off.bind(provider) : undefined,
  };
}
