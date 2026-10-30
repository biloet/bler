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
  if (!isFinite(n)) return "-";
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
  const handle = m.socials?.twitter ? m.socials.twitter.replace(/^https?:\/\/(x|twitter)\.com\//, "").split(/[/?#]/)[0] : "";
  const sub = $("#tSub");
  sub.textContent = `$${m.symbol}`;
  if (m.deployer) {
    const by = document.createElement("button");
    by.type = "button";
    by.className = "t-by";
    by.dataset.creator = m.deployer;
    by.textContent = ` · by ${handle ? "@" + handle : m.deployer.slice(0, 6) + "…" + m.deployer.slice(-4)}`;
    sub.appendChild(by);
  }
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
  $("#tHold").textContent = readWallet().account ? fmtNum(Number(formatUnits(m.balance, m.decimals))) : "-";
  const pct = (m.progress * 100).toFixed(1);
  $("#tProg").textContent = m.tradable ? `${pct}%` : "Graduated";
  $("#tProgBar").style.width = `${m.tradable ? pct : 100}%`;
  $("#tLink").href = `${pons().EXPLORER}/token/${m.token}`;

  const blocked = !m.tradable
    ? "This token graduated to Uniswap V4 and no longer trades on the curve."
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
    $("#tOut").textContent = "-";
    $("#tMin").textContent = "-";
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
  loadTrades(); // chart + trade list load in the background
}

// ---------------------------------------------------------------------------
// Chart + recent trades
// ---------------------------------------------------------------------------
let tradeData = null; // { token, launchBlock, launchTs, toBlock, trades }
let tradesBusy = false;

const timeAgo = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

async function loadTrades() {
  if (tradesBusy || !market) return;
  const m = market;
  tradesBusy = true;
  try {
    const res = await pons().getTradesCached(m, { maxAgeMs: 4000 });
    if (market?.token !== m.token) return; // user switched tokens meanwhile
    tradeData = { ...res, token: m.token };
    renderChart();
    renderTrades();
  } catch (err) {
    if (!tradeData || tradeData.token !== m.token) {
      $("#tChartMsg").hidden = false;
      $("#tChartMsg").textContent = "Couldn't load trades. Retrying…";
    }
  } finally {
    tradesBusy = false;
  }
}

function chartPoints() {
  const m = market, d = tradeData;
  // launch price: phantom ETH reserve / total supply (all supply starts on the curve)
  const phantom = Number(m.quoteReserve - m.realQuote) / 1e18;
  const startPrice = phantom / (Number(m.totalSupply) / 10 ** m.decimals);
  const pts = [{ ts: d.launchTs, price: startPrice, side: "launch" }];
  for (const t of d.trades) pts.push(t);
  pts.push({ ts: Math.max(Date.now(), d.headTs), price: m.priceEth, side: "now" });
  return pts;
}

function renderChart() {
  const svg = $("#tSvg"), msg = $("#tChartMsg");
  if (!market || !tradeData) return;
  const pts = chartPoints();
  const W = svg.clientWidth || 320, H = svg.clientHeight || 140, P = 6;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  // x = trade order (evenly spaced), so bursts of trades stay readable; the
  // tooltip shows when each one happened
  let lo = Math.min(...pts.map((p) => p.price)), hi = Math.max(...pts.map((p) => p.price));
  if (hi === lo) { hi *= 1.05; lo *= 0.95; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const x = (i) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P);
  const y = (pr) => H - P - ((pr - lo) / (hi - lo)) * (H - 2 * P);
  const xy = pts.map((p, i) => [x(i), y(p.price)]);
  const line = xy.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${H} L${xy[0][0].toFixed(1)},${H} Z`;
  const up = pts[pts.length - 1].price >= pts[0].price;
  const col = up ? "#3ee08f" : "#ff5a5f";
  // dots for the most recent 80 trades
  const trades = pts.map((p, i) => ({ p, i })).filter(({ p }) => p.side === "buy" || p.side === "sell").slice(-80);
  const dots = trades.map(({ p, i }) =>
    `<circle cx="${xy[i][0].toFixed(1)}" cy="${xy[i][1].toFixed(1)}" r="3.2" fill="${p.side === "buy" ? "#3ee08f" : "#ff5a5f"}" stroke="#0f0f12" stroke-width="1.2"/>`
  ).join("");
  svg.innerHTML = `
    <defs><linearGradient id="tFill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity=".28"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#tFill)"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>
    ${dots}
    <line id="tCross" x1="0" x2="0" y1="0" y2="${H}" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3" visibility="hidden"/>
    <circle id="tCrossDot" r="4.5" fill="#fff" visibility="hidden"/>`;
  msg.hidden = tradeData.trades.length > 0;
  msg.textContent = "No trades yet. Be the first";
  svg._pts = pts;
  svg._xy = xy;
  showTip(null);
}

function showTip(i) {
  const svg = $("#tSvg"), tip = $("#tTip");
  const cross = svg.querySelector("#tCross"), dot = svg.querySelector("#tCrossDot");
  if (i == null || !svg._pts) {
    cross?.setAttribute("visibility", "hidden");
    dot?.setAttribute("visibility", "hidden");
    tip.textContent = market ? `${fmtNum(market.priceEth)} ETH` : "";
    tip.className = "t-tip";
    return;
  }
  const p = svg._pts[i], [cx, cy] = svg._xy[i];
  cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
  dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
  const label = p.side === "buy" ? "Buy" : p.side === "sell" ? "Sell" : p.side === "launch" ? "Launch" : "Now";
  tip.textContent = `${label} · ${fmtNum(p.price)} ETH · ${timeAgo(p.ts)}`;
  tip.className = "t-tip " + (p.side === "buy" ? "up" : p.side === "sell" ? "down" : "");
}

function nearestPoint(e) {
  const svg = $("#tSvg");
  if (!svg._xy) return null;
  const r = svg.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * (svg.viewBox.baseVal.width || r.width);
  let best = 0, bd = Infinity;
  svg._xy.forEach(([x], i) => { const d = Math.abs(x - px); if (d < bd) { bd = d; best = i; } });
  return best;
}
$("#tSvg").addEventListener("pointermove", (e) => showTip(nearestPoint(e)));
$("#tSvg").addEventListener("pointerdown", (e) => showTip(nearestPoint(e)));
$("#tSvg").addEventListener("pointerleave", () => showTip(null));

function renderTrades() {
  const box = $("#tTrades");
  const list = tradeData.trades.slice(-12).reverse();
  $("#tTradesCount").textContent = tradeData.trades.length ? `${tradeData.trades.length} total` : "";
  if (!list.length) {
    box.innerHTML = '<div class="muted small t-trades-empty">No trades yet.</div>';
    return;
  }
  box.innerHTML = "";
  for (const t of list) {
    const a = document.createElement("a");
    a.className = "t-row";
    a.href = `${pons().EXPLORER}/tx/${t.hash}`;
    a.target = "_blank";
    a.rel = "noopener";
    const side = document.createElement("span");
    side.className = "t-side " + (t.side === "buy" ? "up" : "down");
    side.textContent = t.side === "buy" ? "Buy" : "Sell";
    const eth = document.createElement("span");
    eth.className = "t-eth";
    eth.textContent = `${fmtNum(t.eth)} ETH`;
    const tok = document.createElement("span");
    tok.className = "t-tok muted";
    tok.textContent = `${fmtNum(t.tokens)} ${market.symbol}`;
    const who = document.createElement("span");
    who.className = "t-who muted";
    who.textContent = `${t.account.slice(0, 6)}…${t.account.slice(-4)} · ${timeAgo(t.ts)}`;
    a.append(side, eth, tok, who);
    box.appendChild(a);
  }
}
window.addEventListener("resize", () => { if (!$("#tradeModal").hidden) renderChart(); });

// Shareable token links: #/t/<address>
const TOKEN_HASH = /^#\/t\/(0x[0-9a-fA-F]{40})$/;
// shareable link: /t/<address> serves link-preview tags, then opens #/t/<address>
const tokenUrl = (token) => `${location.origin}/t/${token}`;

function setShare(m) {
  const handle = m.socials?.twitter ? m.socials.twitter.replace(/^https?:\/\/(x|twitter)\.com\//, "").split(/[/?#]/)[0] : "";
  const who = handle ? ` @${handle}` : "";
  const text = `$${m.symbol}${who} is live on BLER 🚀\nTrade it on Robinhood Chain:`;
  $("#tShareX").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(tokenUrl(m.token))}`;
}

async function open(addr, { side: startSide = "buy", justLaunched = false } = {}) {
  if (!pons()) return ui().toast("Still loading. Try again in a second");
  if (!isAddress(addr)) return ui().toast("That doesn't look like a token address");
  const token = getAddress(addr);
  clearInterval(refreshTimer); // stop refreshing the previous token
  market = null;
  ["#tPrice", "#tMcap", "#tHold", "#tProg", "#tOut", "#tMin", "#tFees"].forEach((s) => ($(s).textContent = "-"));
  $("#tradeTitle").textContent = "Loading…";
  $("#tSub").textContent = "";
  $("#tCaAddr").textContent = token;
  $("#tCaCopy").textContent = "Copy";
  $("#tLogo").textContent = "";
  setStatus("");
  setSide(startSide === "sell" ? "sell" : "buy");
  tradeData = null;
  $("#tShareX").classList.toggle("pulse", justLaunched);
  $("#tShareX").removeAttribute("href");
  if (location.hash !== `#/t/${token}`) history.replaceState(null, "", `#/t/${token}`);
  $("#tSvg").innerHTML = "";
  $("#tChartMsg").hidden = false;
  $("#tChartMsg").textContent = "Loading chart…";
  $("#tTrades").innerHTML = "";
  $("#tTradesCount").textContent = "";
  $("#tTip").textContent = "";
  ui().openModal("tradeModal");
  try {
    await load(token);
  } catch (err) {
    $("#tradeTitle").textContent = "Couldn't load token";
    setStatus(err?.message || "Failed to read the token from Robinhood Chain", "err");
    return;
  }
  setShare(market);
  if (justLaunched) setStatus("Your token is live. Share it on X to get your first buyers.", "ok");
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if ($("#tradeModal").hidden) return clearInterval(refreshTimer);
    if (!busy && market) load(market.token).catch(() => {});
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
  label.textContent = ok ? "Copied" : "Copy failed";
  label.classList.toggle("done", ok);
  ui().toast(ok ? "Contract address copied" : "Couldn't copy. Long-press the address to copy it", ok ? "ok" : "err");
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
      setStatus(`Bought ${tokStr(res.tokensOut, market)}`, "ok");
      ui().toast(`Bought ${tokStr(res.tokensOut, market)}`, "buy");
    } else {
      const res = await pons().sell({ ...args, tokensIn: amt });
      setStatus(`Sold for ${ethStr(res.ethOut)}`, "ok");
      ui().toast(`Sold for ${ethStr(res.ethOut)}`, "sell");
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


$("#tCopyLink").addEventListener("click", async () => {
  if (!market) return;
  const ok = await copyText(tokenUrl(market.token));
  ui().toast(ok ? "Link copied. Paste it anywhere" : "Couldn't copy the link", ok ? "ok" : "err");
});

// Closing the panel clears the token link from the URL
new MutationObserver(() => {
  if ($("#tradeModal").hidden && TOKEN_HASH.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}).observe($("#tradeModal"), { attributes: true, attributeFilter: ["hidden"] });

function openFromHash() {
  const m = location.hash.match(TOKEN_HASH);
  if (m && (!market || market.token.toLowerCase() !== m[1].toLowerCase() || $("#tradeModal").hidden)) open(m[1]);
}
window.addEventListener("hashchange", openFromHash);
if (window.blerPons) openFromHash();
else window.addEventListener("bler:pons-ready", openFromHash, { once: true });

window.blerTrade = { open };
