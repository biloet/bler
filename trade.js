// Buy / sell panel for Pons V2 bonding-curve tokens.
import { formatEther, formatUnits, parseEther, parseUnits, isAddress, getAddress } from "./assets/vendor/viem-2.21.0.js";

const $ = (s) => document.querySelector(s);
const ui = () => window.blerUI;
const pons = () => window.blerPons;
const wallet = () => window.blerWallet;

let market = null;
let side = "buy";
let refreshTimer = null;
let busy = false;

function fmtNum(n, max = 4) {
  if (!isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  if (n >= 1) return n.toFixed(Math.min(max, 4)).replace(/\.?0+$/, "");
  // small numbers: 3 significant digits; long zero runs as 0.0₈172 (DEX style)
  const [mant, exp] = n.toExponential(2).split("e");
  const zeros = -Number(exp) - 1;
  const digits = mant.replace(".", "").replace(/0+$/, "") || "0";
  if (zeros < 4) return "0." + "0".repeat(zeros) + digits;
  const sub = String(zeros).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[d]);
  return `0.0${sub}${digits}`;
}
const ethStr = (wei) => fmtNum(Number(formatEther(wei)), 6) + " ETH";
const tokStr = (amt, m) => fmtNum(Number(formatUnits(amt, m.decimals))) + " " + m.symbol;

function readWallet() {
  const w = wallet();
  const onChain = w?.address && w.chainId === pons().CHAIN_ID;
  return { w, onChain, provider: onChain ? w.provider : undefined, account: onChain ? w.address : undefined };
}

function setStatus(text, kind = "") {
  const el = $("#tStatus");
  delete el.dataset.notice;
  el.hidden = !text;
  el.textContent = text || "";
  el.className = "launch-status " + kind;
}

function renderMarket() {
  const m = market;
  $("#tradeTitle").textContent = m.name;
  $("#tSub").textContent = `$${m.symbol}`;
  $("#tCaAddr").textContent = m.token;
  const logo = $("#tLogo");
  logo.textContent = "";
  logo.style.backgroundImage = "";
  if (m.logo) {
    const img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onload = () => { logo.textContent = ""; logo.appendChild(img); };
    img.onerror = () => { logo.textContent = m.symbol[0] || "?"; };
    img.src = m.logo;
    logo.textContent = m.symbol[0] || "?";
  } else {
    logo.textContent = m.symbol[0] || "?";
  }
  $("#tPrice").textContent = fmtNum(m.priceEth) + " ETH";
  $("#tMcap").textContent = fmtNum(m.mcapEth, 2) + " ETH";
  $("#tHold").textContent = readWallet().account ? fmtNum(Number(formatUnits(m.balance, m.decimals))) : "—";
  const pct = (m.progress * 100).toFixed(1);
  $("#tProg").textContent = m.tradable ? `${pct}%` : "Graduated";
  $("#tProgBar").style.width = `${m.tradable ? pct : 100}%`;
  $("#tLink").href = `${pons().EXPLORER}/token/${m.token}`;

  const blocked = !m.tradable
    ? "This token graduated to Uniswap V4 — it no longer trades on the curve."
    : !m.native
      ? "This token is paired with an ERC-20, not ETH. BLER trades ETH pairs only for now."
      : "";
  $("#tBtn").disabled = !!blocked;
  // Only manage the notices this function owns; leave trade results/errors alone.
  const notice = blocked
    ? [blocked, "err"]
    : m.snipeBps > 0n && side === "buy"
      ? [`Launch window: a ${Number(m.snipeBps) / 100}% anti-sniper tax applies to buys right now.`, ""]
      : null;
  const el = $("#tStatus");
  if (notice) { setStatus(...notice); el.dataset.notice = "1"; }
  else if (el.dataset.notice) { setStatus(""); delete el.dataset.notice; }
  renderQuote();
}

function renderQuick() {
  const q = $("#tQuick");
  q.innerHTML = "";
  const opts = side === "buy" ? ["0.001", "0.005", "0.01", "0.05"] : ["25%", "50%", "75%", "100%"];
  for (const o of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-btn";
    b.textContent = side === "buy" ? `${o} ETH` : o;
    b.addEventListener("click", () => {
      if (side === "buy") $("#tAmt").value = o;
      else if (market) {
        // show a short number, but trade the exact amount (100% = whole balance)
        const amt = (market.balance * BigInt(parseInt(o))) / 100n;
        const full = formatUnits(amt, market.decimals);
        const [i, f = ""] = full.split(".");
        const shown = f ? `${i}.${f.slice(0, 4)}`.replace(/\.?0+$/, "") : i;
        const input = $("#tAmt");
        input.value = shown;
        input.dataset.exact = amt.toString();
        input.dataset.shown = shown;
      }
      renderQuote();
    });
    q.appendChild(b);
  }
}

function parseAmount() {
  const input = $("#tAmt");
  if (side === "sell" && input.dataset.exact && input.value === input.dataset.shown) return BigInt(input.dataset.exact);
  const raw = input.value.trim().replace(",", ".");
  if (!raw || !/^\d*\.?\d*$/.test(raw) || raw === ".") return 0n;
  try {
    return side === "buy" ? parseEther(raw) : parseUnits(raw, market?.decimals ?? 18);
  } catch {
    return 0n;
  }
}

function renderQuote() {
  const m = market;
  if (!m) return;
  const amt = parseAmount();
  const slip = Number($("#tSlip").value);
  const P = pons();
  const feePct = (Number(m.feeBps) + Number(m.creatorTaxBps)) / 100;
  $("#tFees").textContent = `${feePct}% (${Number(m.feeBps) / 100}% curve + ${Number(m.creatorTaxBps) / 100}% creator)`;
  if (amt === 0n) {
    $("#tOut").textContent = "—";
    $("#tMin").textContent = "—";
    return;
  }
  if (side === "buy") {
    const q = P.quoteBuy(m, amt);
    $("#tOut").textContent = tokStr(q.tokensOut, m);
    $("#tMin").textContent = tokStr(P.applySlippage(q.tokensOut, slip), m);
  } else {
    const q = P.quoteSell(m, amt);
    $("#tOut").textContent = ethStr(q.ethOut);
    $("#tMin").textContent = ethStr(P.applySlippage(q.ethOut, slip));
  }
}

function setSide(next) {
  side = next;
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.side === side));
  $("#tAmtLabel").textContent = side === "buy" ? "You pay (ETH)" : `You sell (${market?.symbol ?? "tokens"})`;
  const btn = $("#tBtn");
  btn.textContent = side === "buy" ? "Buy" : "Sell";
  btn.classList.toggle("buy", side === "buy");
  btn.classList.toggle("sell", side === "sell");
  $("#tAmt").value = "";
  delete $("#tAmt").dataset.exact;
  if (!busy) setStatus("");
  renderQuick();
  if (market) renderMarket();
}

async function load(token) {
  const { provider, account } = readWallet();
  market = await pons().getMarket(token, { provider, account });
  renderMarket();
}

async function open(addr) {
  if (!pons()) return ui().toast("Pons V2 is still loading — try again in a second");
  if (!isAddress(addr)) return ui().toast("That doesn't look like a token address");
  const token = getAddress(addr);
  market = null;
  ["#tPrice", "#tMcap", "#tHold", "#tProg", "#tOut", "#tMin", "#tFees"].forEach((s) => ($(s).textContent = "—"));
  $("#tradeTitle").textContent = "Loading…";
  $("#tSub").textContent = "";
  $("#tCaAddr").textContent = token;
  $("#tCaCopy").textContent = "Copy";
  $("#tLogo").textContent = "";
  setStatus("");
  setSide("buy");
  ui().openModal("tradeModal");
  try {
    await load(token);
  } catch (err) {
    $("#tradeTitle").textContent = "Couldn't load token";
    setStatus(err?.message || "Failed to read the token from Robinhood Chain", "err");
    return;
  }
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if ($("#tradeModal").hidden) return clearInterval(refreshTimer);
    if (!busy) load(market.token).catch(() => {});
  }, 10000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older in-app wallet browsers: fall back to a temporary textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
    return ok;
  }
}

$("#tCa").addEventListener("click", async () => {
  const addr = $("#tCaAddr").textContent;
  if (!isAddress(addr)) return;
  const ok = await copyText(addr);
  const label = $("#tCaCopy");
  label.textContent = ok ? "Copied ✓" : "Copy failed";
  label.classList.toggle("done", ok);
  ui().toast(ok ? "Contract address copied" : "Couldn't copy — long-press the address to copy it");
  clearTimeout(label._t);
  label._t = setTimeout(() => { label.textContent = "Copy"; label.classList.remove("done"); }, 2000);
});

$("#tAmt").addEventListener("input", renderQuote);
$("#tSlip").addEventListener("change", renderQuote);
document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => setSide(b.dataset.side)));

$("#tradeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy || !market) return;
  const { w, onChain } = readWallet();
  if (!w?.address) {
    ui().closeModals();
    ui().openModal("walletModal");
    ui().toast("Connect your wallet to trade");
    return;
  }
  const amt = parseAmount();
  if (amt === 0n) return setStatus("Enter an amount.", "err");
  busy = true;
  $("#tBtn").disabled = true;
  try {
    if (!onChain) {
      setStatus("Switching to Robinhood Chain…");
      await w.ensureChain();
    }
    await load(market.token); // fresh reserves + balances right before trading
    const slippageBps = Number($("#tSlip").value);
    const args = { provider: w.provider, account: w.address, market, slippageBps, onStep: (t) => setStatus(t) };
    if (side === "buy") {
      if (amt > market.ethBalance) throw new Error("Not enough ETH in your wallet for this buy plus gas.");
      const res = await pons().buy({ ...args, ethIn: amt });
      setStatus(`Bought ${tokStr(res.tokensOut, market)} ✓`, "ok");
      ui().toast(`Bought ${tokStr(res.tokensOut, market)} 🟢`);
    } else {
      const res = await pons().sell({ ...args, tokensIn: amt });
      setStatus(`Sold for ${ethStr(res.ethOut)} ✓`, "ok");
      ui().toast(`Sold for ${ethStr(res.ethOut)} 🔴`);
    }
    $("#tAmt").value = "";
    delete $("#tAmt").dataset.exact;
    await load(market.token).catch(() => {});
  } catch (err) {
    setStatus(err?.message || "Trade failed", "err");
  } finally {
    busy = false;
    $("#tBtn").disabled = !(market?.tradable && market?.native);
  }
});

$("#lookupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  open(new FormData(e.target).get("addr").trim());
});

window.blerTrade = { open };
