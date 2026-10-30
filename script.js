(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const yr = $("#year");
  if (yr) yr.textContent = new Date().getFullYear();

  // ---------- Toast ----------
  let toastTimer;
  // kind: "info" | "ok" | "buy" | "sell" | "err" (a glowing dot shows the kind)
  function toast(msg, kind = "info") {
    const t = $("#toast");
    t.textContent = msg;
    t.dataset.kind = kind;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Modals ----------
  function openModal(id) {
    // Reown AppKit replaces the built-in wallet picker when it's configured
    if (id === "walletModal" && window.blerAppKit?.ready) { window.blerAppKit.open(); return; }
    const m = document.getElementById(id);
    m.hidden = false;
    document.body.style.overflow = "hidden";
    const focusable = m.querySelector("input");
    if (focusable) setTimeout(() => focusable.focus(), 50);
  }
  function closeModals() {
    $$(".modal").forEach((m) => (m.hidden = true));
    document.body.style.overflow = "";
  }
  // delegated so buttons rendered later (feed, stories, empty states) work too
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-wallet]")) openModal("walletModal");
    else if (e.target.closest("[data-open-launch]")) { openModal("launchModal"); refreshLaunchInfo(); }
  });
  window.blerUI = { openModal, closeModals, toast: (m, k) => toast(m, k) };
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeModals());


  // ---------- Launches → Explore ----------
  // Explore reads from chain (explore.js). Here we only remember launches made in
  // this browser so a just-sent tx shows up as "pending" until it confirms.
  const LAUNCH_KEY = "bler-launches";
  const loadLaunches = () => {
    try { return (JSON.parse(localStorage.getItem(LAUNCH_KEY)) || []).filter((t) => t.hash); } catch { return []; }
  };
  const saveLaunches = (list) => {
    try { localStorage.setItem(LAUNCH_KEY, JSON.stringify(list)); return true; } catch { return false; }
  };
  const rememberLaunch = (entry) => {
    const list = loadLaunches().filter((t) => t.hash !== entry.hash);
    list.push(entry);
    saveLaunches(list);
    window.dispatchEvent(new CustomEvent("bler:launched", { detail: entry }));
  };

  // Live launch info (fee / permission) from the Pons V2 factory
  async function refreshLaunchInfo() {
    const w = window.blerWallet, el = $("#launchFee");
    if (!w?.address) return (el.textContent = "connect wallet");
    if (w.chainId !== 4663) return (el.textContent = "switch to Robinhood Chain");
    if (!window.blerPons) return (el.textContent = "loading…");
    el.textContent = "checking…";
    try {
      const st = await window.blerPons.readStatus(w.provider, w.address);
      el.textContent = `${st.launchFeeEth} ETH` + (st.canLaunch && st.launchEnabled ? "" : " · not open for this wallet");
    } catch (err) {
      el.textContent = "unavailable";
    }
  }
  window.addEventListener("bler:wallet", () => { if (!$("#launchModal").hidden) refreshLaunchInfo(); });
  window.addEventListener("bler:pons-ready", () => { if (!$("#launchModal").hidden) refreshLaunchInfo(); });

  const setStatus = (text, kind = "") => {
    const el = $("#launchStatus");
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "launch-status " + kind;
  };

  let launching = false;
  $("#launchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (launching) return;
    const w = window.blerWallet;
    if (!w?.address) {
      closeModals();
      openModal("walletModal");
      toast("Connect your wallet first, then launch");
      return;
    }
    if (!window.blerPons) return toast("Still loading. Try again in a second");

    const data = new FormData(e.target);
    const handle = String(data.get("handle")).trim().replace(/^@+/, "").replace(/[^A-Za-z0-9_.]/g, "").slice(0, 30);
    const symbol = String(data.get("ticker")).trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const name = String(data.get("name") || "").trim().slice(0, 32) || handle;
    const platform = data.get("platform") === "fomo" ? "fomo" : "x";
    const creatorTaxBps = Number(data.get("creatorTax")) || 0;
    if (!handle || symbol.length < 2) return setStatus("Enter a username and a ticker (2–10 letters/numbers).", "err");

    const btn = $("#launchBtn");
    launching = true;
    btn.disabled = true;
    try {
      if (w.chainId !== 4663) {
        setStatus("Switching to Robinhood Chain…");
        await w.ensureChain();
      }
      const base = { name, symbol, handle, platform, deployer: w.address, createdAt: Date.now() };
      const res = await window.blerPons.launchToken({
        provider: w.provider, account: w.address, name, symbol, handle, platform, creatorTaxBps,
        onStep: (t) => setStatus(t),
        // save the tx right away so the launch is never lost if the page closes
        onSent: (hash) => rememberLaunch({ ...base, hash, status: "pending" }),
      });
      rememberLaunch({ ...base, hash: res.hash, status: "live", token: res.token, curve: res.curve });
      setStatus("");
      closeModals();
      e.target.reset();
      // open the new token's page right away so it can be shared
      if (window.blerTrade) window.blerTrade.open(res.token, { justLaunched: true });
      else document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" });
      toast(`$${symbol} is live`, "ok");
    } catch (err) {
      setStatus(err?.message || "Launch failed", "err");
    } finally {
      launching = false;
      btn.disabled = false;
    }
  });

})();

// ================= Wallet (EIP-1193 / EIP-6963) =================
(() => {
  const CHAIN_ID = 4663;
  const CHAIN = {
    chainId: "0x" + CHAIN_ID.toString(16),
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  };
  const STORE_KEY = "bler-wallet";
  const $ = (s) => document.querySelector(s);
  const toast = (msg, kind = "info") => {
    const t = $("#toast");
    t.textContent = msg;
    t.dataset.kind = kind;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 3200);
  };
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Discover wallets (EIP-6963), with window.ethereum as fallback
  const announced = [];
  addEventListener("eip6963:announceProvider", (e) => announced.push(e.detail));
  dispatchEvent(new Event("eip6963:requestProvider"));

  function findProvider(kind) {
    const byRdns = (r) => announced.find((d) => d.info?.rdns === r)?.provider;
    const eth = window.ethereum;
    const list = eth?.providers?.length ? eth.providers : eth ? [eth] : [];
    if (kind === "metamask") return byRdns("io.metamask") || list.find((p) => p.isMetaMask && !p.isCoinbaseWallet && !p.isBitKeep && !p.isBitgetWallet);
    if (kind === "bitget") return byRdns("com.bitget.web3") || window.bitkeep?.ethereum || list.find((p) => p.isBitKeep || p.isBitgetWallet);
    if (kind === "coinbase") return byRdns("com.coinbase.wallet") || list.find((p) => p.isCoinbaseWallet);
    return announced[0]?.provider || list[0];
  }

  function openInWalletApp(kind) {
    const url = location.href.replace(/#.*$/, "");
    if (kind === "coinbase") {
      location.href = "https://go.cb-w.com/dapp?cb_url=" + encodeURIComponent(url);
    } else if (kind === "bitget") {
      location.href = "https://bkcode.vip?action=dapp&url=" + encodeURIComponent(url);
    } else {
      location.href = "https://metamask.app.link/dapp/" + url.replace(/^https?:\/\//, "");
    }
  }

  const state = (window.blerWallet = { provider: null, address: null, chainId: null, kind: null });
  state.ensureChain = () => ensureChain();
  // Reown AppKit (appkit.js) drives the wallet state through these two hooks
  state.useExternal = ({ provider, address, chainId, kind = "reown" }) => {
    state.provider = provider;
    state.kind = kind;
    state.address = address || null;
    state.chainId = chainId ?? null;
    render();
  };
  state.clearExternal = () => {
    if (state.kind !== "reown") return;
    state.provider = null;
    state.address = null;
    state.chainId = null;
    render();
  };
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

  function formatEth(hexWei) {
    const wei = BigInt(hexWei);
    const whole = wei / 10n ** 18n;
    const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
    return `${whole}.${frac} ETH`;
  }

  async function refreshBalance() {
    if (!state.address || state.chainId !== CHAIN_ID) return ($("#acctBal").textContent = "-");
    try {
      const bal = await state.provider.request({ method: "eth_getBalance", params: [state.address, "latest"] });
      $("#acctBal").textContent = formatEth(bal);
    } catch {
      $("#acctBal").textContent = "-";
    }
  }

  function render() {
    window.dispatchEvent(new Event("bler:wallet"));
    const connected = !!state.address;
    const onChain = state.chainId === CHAIN_ID;
    document.querySelectorAll("[data-open-wallet]").forEach((b) => {
      b.textContent = connected ? (onChain ? "● " : "○ ") + short(state.address) : "Connect wallet";
      b.classList.toggle("is-connected", connected);
      b.classList.toggle("wrong-net", connected && !onChain);
    });
    $("#walletChoose").hidden = connected;
    $("#walletConnected").hidden = !connected;
    $("#walletTitle").textContent = connected ? "Your wallet" : "Connect wallet";
    if (connected) {
      const a = $("#acctAddr");
      a.textContent = short(state.address);
      a.href = `${CHAIN.blockExplorerUrls[0]}/address/${state.address}`;
      $("#acctNet").textContent = onChain ? "Robinhood Chain" : `Wrong network (${state.chainId})`;
      $("#acctNet").className = onChain ? "up" : "down";
      $("#switchNet").hidden = onChain;
      refreshBalance();
    }
  }

  async function ensureChain() {
    if (state.kind === "reown" && window.blerAppKit) return window.blerAppKit.switchToRobinhood();
    try {
      await state.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] });
    } catch (err) {
      const code = err?.code ?? err?.data?.originalError?.code;
      if (code === 4902 || /unrecognized|not added|unknown chain/i.test(err?.message || "")) {
        await state.provider.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
      } else {
        throw err;
      }
    }
  }

  function attach(provider, kind) {
    if (state.provider === provider) return;
    state.provider = provider;
    state.kind = kind;
    provider.on?.("accountsChanged", (accs) => {
      state.address = accs[0] || null;
      if (!state.address) forget();
      render();
    });
    provider.on?.("chainChanged", (id) => {
      state.chainId = parseInt(id, 16);
      render();
    });
  }

  function forget() {
    state.address = null;
    try { localStorage.removeItem(STORE_KEY); } catch {}
  }

  async function connect(kind) {
    const provider = findProvider(kind);
    if (!provider) {
      if (isMobile) return openInWalletApp(kind);
      const install = {
        metamask: ["MetaMask", "https://metamask.io/download/"],
        coinbase: ["the Coinbase Wallet extension", "https://www.coinbase.com/wallet/downloads"],
        bitget: ["Bitget Wallet", "https://web3.bitget.com/en/wallet-download"],
      }[kind];
      toast(install ? `Install ${install[0]} first` : "Install a wallet extension first");
      if (install) window.open(install[1], "_blank", "noopener");
      return;
    }
    attach(provider, kind);
    try {
      const accs = await provider.request({ method: "eth_requestAccounts" });
      state.address = accs[0];
      state.chainId = parseInt(await provider.request({ method: "eth_chainId" }), 16);
      try { localStorage.setItem(STORE_KEY, kind); } catch {}
      render();
      if (state.chainId !== CHAIN_ID) {
        try {
          await ensureChain();
        } catch {
          toast("Connected. Switch to Robinhood Chain to continue");
          return;
        }
      }
      toast("Wallet connected", "ok");
    } catch (err) {
      toast(err?.code === 4001 ? "Request rejected in wallet" : "Could not connect: " + (err?.message || "unknown error"));
    }
  }

  document.querySelectorAll(".wallet").forEach((b) => b.addEventListener("click", () => connect(b.dataset.wallet)));
  $("#switchNet").addEventListener("click", () =>
    ensureChain().catch((e) => toast(e?.code === 4001 ? "Request rejected in wallet" : "Could not switch network"))
  );
  $("#disconnect").addEventListener("click", async () => {
    try { await state.provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch {}
    forget();
    render();
    toast("Disconnected");
  });

  // Restore a previous session without prompting (AppKit restores its own)
  setTimeout(async () => {
    if (window.BLER_CONFIG?.reownProjectId) return;
    let kind = null;
    try { kind = localStorage.getItem(STORE_KEY); } catch {}
    const provider = kind && findProvider(kind);
    if (!provider) return;
    try {
      const accs = await provider.request({ method: "eth_accounts" });
      if (!accs[0]) return forget();
      attach(provider, kind);
      state.address = accs[0];
      state.chainId = parseInt(await provider.request({ method: "eth_chainId" }), 16);
      render();
    } catch {}
  }, 300);
})();
