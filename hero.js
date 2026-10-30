// Hero showcase: real BLER tokens instead of a mock.
// Cycles through the most active BLER tokens (from explore.js), with a live
// price chart of real buys/sells. Buy/Sell open the token's trade panel.
const $ = (s) => document.querySelector(s);
const pons = () => window.blerPons;

const ROTATE_MS = 6000;
const MAX_FEATURED = 5;
const GRADS = [["#ff8a00", "#e52e71"], ["#00c6ff", "#0072ff"], ["#7f00ff", "#e100ff"], ["#11998e", "#38ef7d"], ["#f7971e", "#ffd200"], ["#fc466b", "#3f5efb"]];

let featured = []; // tokens from the index
let idx = 0;
let timer = null;
let paused = false;
let data = { tokens: [], stats: new Map(), sparks: new Map() };

function fmtNum(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  if (n >= 1) return n.toFixed(2).replace(/\.?0+$/, "");
  const [mant, exp] = n.toExponential(2).split("e");
  const zeros = -Number(exp) - 1;
  const digits = mant.replace(".", "").replace(/0+$/, "") || "0";
  if (zeros < 4) return "0." + "0".repeat(zeros) + digits;
  return `0.0${String(zeros).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[d])}${digits}`;
}

function pickFeatured() {
  const score = (t) => (data.sparks.get(t.token)?.count ?? 0) * 1000 + (data.stats.get(t.token)?.mcapEth ?? 0);
  return [...data.tokens].filter((t) => t.native !== false).sort((a, b) => score(b) - score(a)).slice(0, MAX_FEATURED);
}

function setAvatar(t) {
  const el = $("#hAvatar");
  const g = GRADS[(t?.symbol || "?").length % GRADS.length];
  el.className = "avatar round";
  el.style.background = `linear-gradient(135deg,${g[0]},${g[1]})`;
  el.textContent = (t?.symbol || "B")[0].toUpperCase();
  const logo = t?.logo ? pons()?.ipfsToHttp(t.logo) : "";
  if (logo) {
    const img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onload = () => el.appendChild(img);
    img.src = logo;
  }
}

function drawChart(trades, st) {
  const svg = $("#hChart");
  const W = svg.clientWidth || 600, H = svg.clientHeight || 160, P = 8;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const pts = [];
  if (st?.launchPrice) pts.push({ price: st.launchPrice, side: "launch" });
  for (const t of trades || []) pts.push(t);
  if (st?.priceEth) pts.push({ price: st.priceEth, side: "now" });
  if (pts.length < 2) {
    svg.innerHTML = `<line x1="${P}" y1="${H / 2}" x2="${W - P}" y2="${H / 2}" stroke="rgba(255,255,255,.18)" stroke-width="2" stroke-dasharray="6 6"/>`;
    return;
  }
  let lo = Math.min(...pts.map((p) => p.price)), hi = Math.max(...pts.map((p) => p.price));
  if (hi === lo) { hi *= 1.05; lo *= 0.95; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const xy = pts.map((p, i) => [P + (i / (pts.length - 1)) * (W - 2 * P), H - P - ((p.price - lo) / (hi - lo)) * (H - 2 * P)]);
  const line = xy.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  const area = `${line} L${xy.at(-1)[0].toFixed(1)},${H} L${xy[0][0].toFixed(1)},${H} Z`;
  const up = pts.at(-1).price >= pts[0].price;
  const col = up ? "#3ee08f" : "#ff5a5f";
  const dots = pts.map((p, i) => (p.side === "buy" || p.side === "sell")
    ? `<circle cx="${xy[i][0].toFixed(1)}" cy="${xy[i][1].toFixed(1)}" r="3.6" fill="${p.side === "buy" ? "#3ee08f" : "#ff5a5f"}" stroke="#121217" stroke-width="1.4"/>` : "").slice(-60).join("");
  svg.innerHTML = `
    <defs><linearGradient id="hFill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity=".32"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#hFill)" class="h-area"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" class="h-line" pathLength="1"/>
    ${dots}`;
}

function renderEmpty() {
  $("#hName").textContent = "Your profile";
  $("#hSym").textContent = "$YOU";
  $("#hTag").textContent = "SOON";
  $("#hHandle").textContent = "Launch on BLER and it shows up here";
  setAvatar({ symbol: "Y" });
  $("#hPrice").textContent = "—";
  $("#hChange").textContent = "";
  ["#hMcap", "#hTrades", "#hCurve", "#hCurve2"].forEach((s) => ($(s).textContent = "—"));
  $("#hBar").style.width = "0%";
  $("#hUrl").textContent = "bler · your token here";
  $("#hBuy").textContent = "Launch";
  $("#hSell").textContent = "Explore";
  $("#hChip").hidden = true;
  $("#hDots").innerHTML = "";
  drawChart([], null);
}

async function show(i, { animate = true } = {}) {
  if (!featured.length) return renderEmpty();
  idx = (i + featured.length) % featured.length;
  const t = featured[idx];
  const st = data.stats.get(t.token) || {};
  const box = $("#hShow");
  if (animate) { box.classList.remove("h-in"); void box.offsetWidth; box.classList.add("h-in"); }

  $("#hName").textContent = t.name;
  $("#hSym").textContent = `$${t.symbol}`;
  $("#hTag").textContent = st.graduated ? "GRADUATED" : "LIVE";
  $("#hHandle").textContent = t.handle ? `${t.platform === "fomo" ? "fomo" : "𝕏"} @${t.handle}` : "Launched on BLER";
  setAvatar(t);
  $("#hPrice").textContent = st.priceEth != null ? `${fmtNum(st.priceEth)} ETH` : "—";
  const ch = $("#hChange");
  if (st.change != null) {
    const up = st.change >= 0, flat = Math.abs(st.change) < 0.0005;
    ch.textContent = flat ? "0.0% since launch" : `${up ? "+" : ""}${(st.change * 100).toFixed(1)}% since launch`;
    ch.className = "change " + (flat ? "flat" : up ? "up" : "down");
  } else ch.textContent = "";
  $("#hMcap").textContent = st.mcapEth != null ? `${fmtNum(st.mcapEth)} ETH` : "—";
  const pct = st.progress != null ? `${(st.progress * 100).toFixed(1)}%` : "—";
  $("#hCurve").textContent = pct;
  $("#hCurve2").textContent = st.graduated ? "Graduated" : pct;
  $("#hBar").style.width = st.graduated ? "100%" : `${Math.max(1, (st.progress || 0) * 100)}%`;
  $("#hUrl").textContent = `bler · $${t.symbol}`;
  $("#hBuy").textContent = "Buy";
  $("#hSell").textContent = "Sell";

  const count = data.sparks.get(t.token)?.count;
  $("#hTrades").textContent = count != null ? String(count) : "…";
  const chip = $("#hChip");
  chip.hidden = false;
  chip.textContent = count ? `⚡ ${count} trade${count === 1 ? "" : "s"} on BLER` : "🚀 Fresh on BLER";

  renderDots();
  drawChart(null, st);
  try {
    const d = await pons().getTradesCached({ token: t.token, curve: t.curve, decimals: 18 }, { maxAgeMs: 20000 });
    if (featured[idx]?.token !== t.token) return; // rotated away meanwhile
    $("#hTrades").textContent = String(d.trades.length);
    chip.textContent = d.trades.length ? `⚡ ${d.trades.length} trade${d.trades.length === 1 ? "" : "s"} on BLER` : "🚀 Fresh on BLER";
    drawChart(d.trades, st);
  } catch {}
}

function renderDots() {
  const box = $("#hDots");
  box.innerHTML = "";
  if (featured.length < 2) return;
  featured.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "h-dot" + (i === idx ? " active" : "");
    b.setAttribute("aria-label", `Show $${t.symbol}`);
    b.addEventListener("click", () => { show(i); restart(); });
    box.appendChild(b);
  });
}

function restart() {
  clearInterval(timer);
  if (featured.length < 2) return;
  timer = setInterval(() => { if (!paused && !document.hidden) show(idx + 1); }, ROTATE_MS);
}

function update(next) {
  data = next;
  const prev = featured[idx]?.token;
  featured = pickFeatured();
  const keep = featured.findIndex((t) => t.token === prev);
  show(keep >= 0 ? keep : 0, { animate: keep < 0 });
  restart();
}

// Buttons: trade the featured token (or launch / explore when there is none)
$("#hBuy").addEventListener("click", () => {
  const t = featured[idx];
  if (t) window.blerTrade?.open(t.token, { side: "buy" });
  else document.querySelector("[data-open-launch]")?.click();
});
$("#hSell").addEventListener("click", () => {
  const t = featured[idx];
  if (t) window.blerTrade?.open(t.token, { side: "sell" });
  else document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
});
const stage = $("#stage");
stage.addEventListener("pointerenter", () => (paused = true));
stage.addEventListener("pointerleave", () => (paused = false));
stage.addEventListener("touchstart", () => { paused = true; setTimeout(() => (paused = false), 8000); }, { passive: true });
window.addEventListener("resize", () => featured.length && show(idx, { animate: false }));

window.addEventListener("bler:explore-data", (e) => update(e.detail));
if (window.blerExplore) {
  const d = window.blerExplore.data();
  if (d.tokens.length) update(d);
}
