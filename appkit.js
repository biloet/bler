// Reown AppKit wallet connection (WalletConnect + injected wallets).
// Active only when window.BLER_CONFIG.reownProjectId is set (see index.html);
// otherwise the built-in wallet picker in script.js is used.
// The connected wallet is handed to script.js (window.blerWallet.useExternal),
// so launching, trading and balances work exactly as before.
const APPKIT_URL = "https://cdn.jsdelivr.net/npm/@reown/appkit-cdn@1.8.24/dist/appkit.js";
const projectId = window.BLER_CONFIG?.reownProjectId || "";

const robinhood = {
  id: 4663,
  caipNetworkId: "eip155:4663",
  chainNamespace: "eip155",
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
};

async function start() {
  const { createAppKit, WagmiAdapter } = await import(APPKIT_URL);
  const wagmiAdapter = new WagmiAdapter({ projectId, networks: [robinhood] });
  const modal = createAppKit({
    adapters: [wagmiAdapter],
    networks: [robinhood],
    defaultNetwork: robinhood,
    projectId,
    metadata: {
      name: "BLER",
      description: "Your clout. Now a market.",
      url: location.origin,
      icons: [`${location.origin}/assets/logo.svg`],
    },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false },
    allowUnsupportedChain: false,
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#1d9bf0",
      "--w3m-color-mix": "#000000",
      "--w3m-color-mix-strength": 20,
      "--w3m-font-family": "Inter, system-ui, sans-serif",
      "--w3m-border-radius-master": "3px",
      "--w3m-z-index": 400,
    },
  });

  const wallet = () => window.blerWallet;
  let address = null, chainId = null;

  // Push AppKit's state into the app's wallet state
  const sync = () => {
    const provider = modal.getWalletProvider();
    if (address && provider) {
      wallet()?.useExternal({ provider, address, chainId: chainId ?? robinhood.id, kind: "reown" });
    } else {
      wallet()?.clearExternal();
    }
  };

  modal.subscribeAccount((acc) => {
    const next = acc?.isConnected ? acc.address : null;
    if (next !== address) { address = next; sync(); }
  });
  modal.subscribeNetwork((n) => {
    const next = typeof n?.chainId === "number" ? n.chainId : n?.chainId ? Number(n.chainId) : null;
    if (next !== chainId) { chainId = next; sync(); }
  });
  modal.subscribeProviders(() => sync());

  window.blerAppKit = {
    ready: true,
    modal,
    open: () => modal.open(address ? { view: "Account" } : undefined),
    switchToRobinhood: () => modal.switchNetwork(robinhood),
    disconnect: () => modal.disconnect(),
  };
  window.dispatchEvent(new Event("bler:appkit-ready"));
}

if (projectId) {
  start().catch((err) => {
    // CDN blocked or AppKit failed: keep the built-in wallet picker
    console.warn("Reown AppKit unavailable, using the built-in wallet picker", err);
  });
}
