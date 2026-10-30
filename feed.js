// BLER social feed (concept B).
// Every BLER token is a "post" in an X-style timeline. Data comes from the
// /api/bler index (BLER launches only) and live chain reads via pons.js.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const pons = () => window.blerPons;
const ui = () => window.blerUI;

const LAUNCH_KEY = "bler-launches";
const PAGE_TARGET = 24;
// Tokens hidden from BLER (they still exist on chain). Keep in sync with api/bler.js.
const HIDDEN = new Set(["0x9991836a0b1c079dbb11af4cdca9c0098f0ff4cd"]);
const visible = (t) => !(t.token && HIDDEN.has(t.token.toLowerCase()));

const state = {
  view: "home", // home | trending | activity | holding | search | about
  tab: "foryou", // foryou | new | holding (home view)
  query: "",
  all: [],
  nextWindow: null,
  stats: new Map(),
  trades: new Map(), // token -> trades[]
  balances: new Map(),
  balancesFor: null,
  loading: false,
  error: false,
  highlight: null,
  creator: null, // deployer address when view === "creator"
  creatorTokens: new Map(), // deployer -> BLER tokens (from chain)
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GRADS = [["#ff8a00", "#e52e71"], ["#00c6ff", "#0072ff"], ["#7f00ff", "#e100ff"], ["#11998e", "#38ef7d"], ["#f7971e", "#ffd200"], ["#fc466b", "#3f5efb"]];
const grad = (t) => GRADS[(t.symbol || "?").length % GRADS.length];
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ago = (t) => {
  if (!t) return "";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
function num(n) {
  if (n == null || !isFinite(n)) return "-";
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
const pct = (c) => (c == null ? "" : Math.abs(c) < 0.0005 ? "0.0%" : `${c >= 0 ? "+" : ""}${(c * 100).toFixed(1)}%`);
const pctCls = (c) => (c == null || Math.abs(c) < 0.0005 ? "flat" : c >= 0 ? "up" : "down");
const localLaunches = () => { try { return (JSON.parse(localStorage.getItem(LAUNCH_KEY)) || []).filter((t) => t.hash); } catch { return []; } };
const saveLocal = (l) => { try { localStorage.setItem(LAUNCH_KEY, JSON.stringify(l)); } catch {} };

function avatar(t, size = "") {
  const g = grad(t);
  const logo = t.logo ? pons()?.ipfsToHttp(t.logo) || "" : "";
  const img = logo ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<div class="av ${size}" style="background:linear-gradient(135deg,${g[0]},${g[1]})">${img}<span>${esc((t.symbol || "?")[0].toUpperCase())}</span></div>`;
}
// Cinematic line icons (glow comes from CSS: .ci / .ei)
const svg = (d, w = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CI = {
  rocket: svg('<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2-.1-2.8-.8-.8-2.1-.8-2.9-.2z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.5-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.5 4-2c1.1-1.6 0-5 0-5"/>'),
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>'),
  flame: svg('<path d="M12 22c4 0 7-2.7 7-7 0-4.2-3-6.6-4.3-9.8-.3-.7-1.2-.8-1.6-.2C11.7 7 12 9 12 9s-1.8-1.3-2.5-3.4c-.2-.6-1-.8-1.4-.3C6.4 7.6 5 10.4 5 15c0 4.3 3 7 7 7z"/><path d="M12 22c-1.7 0-3-1.3-3-3.2 0-2 1.6-3.1 3-4.8 1.4 1.7 3 2.8 3 4.8 0 1.9-1.3 3.2-3 3.2z"/>'),
  cap: svg('<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>'),
  hourglass: svg('<path d="M6 2h12M6 22h12M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10"/>'),
  tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  wallet: svg('<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 9h-5a3 3 0 0 0 0 6h5z"/>', 1.8),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  vault: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M12 17v-1.5M15.5 12H17M7 12h1.5"/>'),
  pulse: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  signal: svg('<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/><path d="M2 9a14.5 14.5 0 0 1 20 0"/>'),
};
const ci = (name, tone) => `<i class="ci ci-${tone}">${CI[name]}</i>`;

const ICON = {
  trades: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  curve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20c6 0 9-4 11-9s4-7 7-7"/><circle cx="21" cy="4" r="1.6"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
};
const xbadge = (t) => (t.handle ? `<span class="xb">${t.platform === "fomo" ? "fomo" : "𝕏"}</span>` : "");

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------
async function fetchWindow(w) {
  const r = await fetch(w == null ? "/api/bler" : `/api/bler?w=${w}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`index ${r.status}`);
  return r.json();
}

async function loadIndex({ reset = false } = {}) {
  let collected = [], next;
  if (reset || state.nextWindow == null) {
    const first = await fetchWindow(null);
    collected = first.tokens;
    next = first.window - 1;
  } else next = state.nextWindow;
  while (next >= 0 && collected.length < PAGE_TARGET) {
    collected = collected.concat((await fetchWindow(next)).tokens);
    next -= 1;
  }
  const merged = reset || state.nextWindow == null ? collected : state.all.concat(collected);
  const seen = new Set();
  state.all = merged.filter((t) => visible(t) && (seen.has(t.token) ? false : (seen.add(t.token), true)));
  state.nextWindow = next;
}

async function loadStats(list) {
  const want = list.filter((t) => t.token && t.curve);
  if (!want.length) return;
  try { (await pons().fetchCurveStats(want)).forEach((v, k) => state.stats.set(k, v)); } catch {}
}

async function loadTrades(list) {
  const queue = list.filter((t) => t.token && t.curve).slice(0, PAGE_TARGET);
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      try {
        const d = await pons().getTradesCached({ token: t.token, curve: t.curve, decimals: 18 }, { maxAgeMs: 25000 });
        state.trades.set(t.token, d.trades);
        render();
        clearTimeout(loadTrades.t);
        loadTrades.t = setTimeout(announceNewTrades, 400);
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

async function loadBalances() {
  const w = window.blerWallet;
  if (!w?.address) return;
  if (sameAddr(state.balancesFor, w.address) && state.balances.size) return;
  try {
    state.balances = await pons().fetchBalances(state.all, w.address);
    state.balancesFor = w.address;
  } catch {}
}

async function resolvePending() {
  const list = localLaunches();
  let changed = false;
  for (const t of list.filter((x) => x.status === "pending")) {
    try {
      const r = await pons().checkLaunchTx(t.hash);
      if (r.status !== "pending") { Object.assign(t, r); changed = true; }
    } catch {}
  }
  if (changed) saveLocal(list.filter((t) => t.status !== "failed"));
  return changed;
}

// launches from this browser that the index hasn't picked up yet
function localExtras() {
  const known = new Set(state.all.flatMap((t) => [t.hash, t.token]).filter(Boolean));
  return localLaunches().filter((t) => (t.status === "pending" || t.status === "live") && !known.has(t.hash) && !(t.token && known.has(t.token)) && visible(t))
    .map((t) => ({ ...t, symbol: t.symbol || (t.ticker || "").replace(/^\$/, ""), name: t.name || t.handle, local: true }));
}

let refreshing = false;
async function refresh(force = false) {
  if (!pons() || refreshing) return;
  refreshing = true;
  state.loading = !state.all.length;
  state.error = false;
  render();
  try {
    const changed = await resolvePending();
    if (force || changed || state.nextWindow == null) await loadIndex({ reset: true });
    await loadStats(state.all);
    if (state.view === "holding" || state.tab === "holding") await loadBalances();
    refresh.retries = 0;
    state.loading = false;
    render();
    loadTrades(sortForYou(state.all));
  } catch (err) {
    console.warn("Feed load failed", err);
    state.error = true;
    refresh.retries = (refresh.retries || 0) + 1;
    if (refresh.retries <= 4) setTimeout(() => refresh(true), 2000 * refresh.retries);
  } finally {
    state.loading = false;
    refreshing = false;
    render();
  }
}

// ---------------------------------------------------------------------------
// ordering
// ---------------------------------------------------------------------------
const tradesOf = (t) => state.trades.get(t.token) || [];
const lastActivity = (t) => Math.max(t.createdAt || 0, ...tradesOf(t).map((x) => x.ts || 0));
function sortForYou(list) {
  // recent activity first, boosted by trade count
  return [...list].sort((a, b) => lastActivity(b) + tradesOf(b).length * 60000 - (lastActivity(a) + tradesOf(a).length * 60000));
}
const sortNew = (list) => [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
const sortTrending = (list) => [...list].sort((a, b) => (state.stats.get(b.token)?.change ?? -9) - (state.stats.get(a.token)?.change ?? -9) || tradesOf(b).length - tradesOf(a).length);

function matches(t, q) {
  if (!q) return true;
  q = q.toLowerCase().replace(/^[@$]/, "");
  return [t.symbol, t.name, t.handle, t.token].some((x) => (x || "").toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function postText(t, st, n) {
  const sym = `<span class="tk">$${esc(t.symbol)}</span>`;
  const ageMs = Date.now() - (t.createdAt || 0);
  if (t.status === "pending") return `Launching ${sym} on BLER… confirming on Robinhood Chain ${ci("hourglass", "amber")}`;
  if (st?.graduated) return `${sym} graduated to Uniswap V4 ${ci("cap", "violet")}`;
  if (st?.progress >= 0.7) return `${sym} is about to graduate: bonding curve ${(st.progress * 100).toFixed(0)}% ${ci("cap", "violet")}`;
  if (ageMs < 3600e3 && n < 3) return `${ci("rocket", "blue")} Just launched my profile on BLER: ${sym}, come early ${ci("spark", "blue")}`;
  if (n === 0) return `${sym} is live. No trades yet. Be the first ${ci("spark", "blue")}`;
  if ((st?.change ?? 0) > 0.2 && n >= 5) return `${ci("flame", "green")} ${sym} is pumping with ${n} trades so far`;
  if ((st?.change ?? 0) < -0.2) return `${sym} is on sale, down ${Math.abs(st.change * 100).toFixed(0)}% since launch ${ci("tag", "pink")}`;
  return `${sym} has ${n} trade${n === 1 ? "" : "s"} so far on BLER`;
}

function chartSvg(t, st, i) {
  const trades = tradesOf(t);
  const pts = [];
  if (st?.launchPrice) pts.push({ price: st.launchPrice });
  for (const x of trades) pts.push(x);
  if (st?.priceEth) pts.push({ price: st.priceEth });
  const W = 560, H = 110, P = 6;
  if (pts.length < 2) return `<svg class="pchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="${P}" y1="${H / 2}" x2="${W - P}" y2="${H / 2}" stroke="#2f3336" stroke-width="2" stroke-dasharray="6 6"/></svg>`;
  let lo = Math.min(...pts.map((p) => p.price)), hi = Math.max(...pts.map((p) => p.price));
  if (hi === lo) { hi *= 1.05; lo *= 0.95; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const xy = pts.map((p, k) => [P + (k / (pts.length - 1)) * (W - 2 * P), H - P - ((p.price - lo) / (hi - lo)) * (H - 2 * P)]);
  const line = xy.map(([a, b], k) => `${k ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  const up = pts.at(-1).price >= pts[0].price;
  const col = up ? "#00ba7c" : "#f91880";
  const dots = pts.length <= 70 ? pts.map((p, k) => (p.side ? `<circle cx="${xy[k][0].toFixed(1)}" cy="${xy[k][1].toFixed(1)}" r="2.6" fill="${p.side === "buy" ? "#00ba7c" : "#f91880"}"/>` : "")).join("") : "";
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="pf${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${xy.at(-1)[0].toFixed(1)},${H} L${xy[0][0].toFixed(1)},${H} Z" fill="url(#pf${i})"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${dots}</svg>`;
}

function post(t, i) {
  const st = state.stats.get(t.token) || {};
  const n = tradesOf(t).length;
  const pending = t.status === "pending";
  const hold = state.balances.get(t.token);
  const holdTxt = hold && hold > 0n ? `<span class="hold">You hold ${num(Number(hold) / 1e18)}</span>` : "";
  const url = `${location.origin}/t/${t.token}`;
  const share = `https://x.com/intent/post?text=${encodeURIComponent(`$${t.symbol}${t.handle ? ` @${t.handle}` : ""} is live on BLER 🚀\nTrade it on Robinhood Chain:`)}&url=${encodeURIComponent(url)}`;
  return `
  <article class="post${t.token && t.token === state.highlight ? " hl" : ""}" data-token="${esc(t.token || "")}" data-hash="${esc(t.hash || "")}">
    <button type="button" class="av-btn" data-creator="${esc(t.deployer || "")}" aria-label="Creator profile">${avatar(t)}</button>
    <div class="pbody">
      <div class="phead"><button type="button" class="pname" data-creator="${esc(t.deployer || "")}">${esc(t.name)}</button>${xbadge(t)}<span class="muted">${t.handle ? `@${esc(t.handle)}` : short(t.token)} · ${ago(t.createdAt)}</span></div>
      <div class="ptext">${postText(t, st, n)}</div>
      ${pending ? "" : `
      <div class="pcard" data-open="${esc(t.token)}">
        <div class="pctop">
          <div><span class="muted">Market cap</span><b>${st.mcapEth != null ? `${num(st.mcapEth)} ETH` : "-"}</b></div>
          <div class="r"><span class="muted">Since launch</span><b class="${pctCls(st.change)}">${pct(st.change) || "-"}</b></div>
        </div>
        ${chartSvg(t, st, i)}
        <div class="pcbot">
          <button type="button" class="pbtn buy" data-trade="buy">Buy $${esc(t.symbol)}</button>
          <button type="button" class="pbtn sell" data-trade="sell">Sell</button>
        </div>
      </div>
      <div class="pacts">
        <span class="pa" title="Trades">${ICON.trades}<b>${n}</b> trade${n === 1 ? "" : "s"}</span>
        <span class="pa" title="Bonding curve → Uniswap V4">${ICON.curve}${st.graduated ? "Graduated" : `Curve <b>${st.progress != null ? `${(st.progress * 100).toFixed(1)}%` : "-"}</b>`}</span>
        ${holdTxt}
        <a href="${esc(share)}" target="_blank" rel="noopener" title="Share on X" class="pa act">${ICON.share}Share</a>
      </div>`}
    </div>
  </article>`;
}

function story(t) {
  const st = state.stats.get(t.token) || {};
  const p = st.graduated ? 100 : Math.max(6, (st.progress || 0) * 100);
  const hot = tradesOf(t).some((x) => Date.now() - (x.ts || 0) < 15 * 60e3);
  return `<button type="button" class="story" data-open="${esc(t.token)}" title="$${esc(t.symbol)}"><span class="ring${hot ? " hot" : ""}" style="--p:${p}%">${avatar(t, "lg")}</span><span class="slabel">$${esc(t.symbol)}</span></button>`;
}

function activityRows() {
  const rows = [];
  for (const t of state.all) for (const x of tradesOf(t)) rows.push({ t, x });
  rows.sort((a, b) => (b.x.ts || 0) - (a.x.ts || 0));
  return rows.slice(0, 50).map(({ t, x }) => `
    <button type="button" class="arow" data-open="${esc(t.token)}">
      ${avatar(t, "md")}
      <span class="atext">
        <span class="aline"><b class="asym">$${esc(t.symbol)}</b><span class="side ${x.side}">${x.side === "buy" ? "Buy" : "Sell"}</span><b class="aeth">${num(x.eth)} ETH</b></span>
        <span class="aline muted"><span class="mono">${short(x.account)}</span> · ${num(x.tokens)} ${esc(t.symbol)} · ${ago(x.ts)} ago</span>
      </span>
    </button>`).join("");
}

const ABOUT = `
  <section class="about">
    <div class="ahero"><img src="assets/logo.svg" alt="" width="56" height="56"><h2>Your clout. Now a market.</h2><p>BLER turns your 𝕏 or fomo profile into a token on Robinhood Chain. Fans buy in on an ETH bonding curve, and you earn ETH on every trade.</p><button type="button" class="btn-launch" data-open-launch>Launch your profile</button></div>
    <h3>How it works</h3>
    <ol class="steps2"><li><b>Plug in</b> Connect your wallet and sign in with 𝕏 or fomo.</li><li><b>Go live</b> One tap launches your token on an ETH bonding curve. Fair launch, no presale, no insiders.</li><li><b>Get paid</b> Fans buy, the price climbs, creator fees in ETH hit your wallet. When the curve sells out, your token graduates to Uniswap V4.</li></ol>
    <h3>FAQ</h3>
    <details><summary>What is BLER?</summary><p>A launchpad that turns your 𝕏 or fomo profile into a live market on Robinhood Chain.</p></details>
    <details><summary>Is it non-custodial?</summary><p>Yes. You trade from your own wallet. BLER never holds your funds.</p></details>
    <details><summary>What is a bonding curve?</summary><p>The price rises as tokens are bought and falls as they are sold, priced in ETH. When the curve sells out, the token moves to a Uniswap V4 pool.</p></details>
    <details><summary>How do I earn as a creator?</summary><p>Every trade on your token pays a creator fee in ETH straight to your wallet.</p></details>
    <p class="muted small">Trading involves risk. Not financial advice.</p>
  </section>`;

function empty(kind) {
  const m = {
    loading: ["", ""],
    error: ["hourglass|amber|Robinhood Chain is busy", "Couldn't load tokens just now. Retrying automatically…"],
    none: ["rocket|blue|No BLER tokens yet", "Be the first to launch your profile."],
    search: ["search|blue|No matches", "Try a ticker, a name, an @handle, or paste a token address."],
    connect: ["wallet|blue|Connect your wallet", "See the BLER tokens you hold."],
    holding: ["vault|violet|Nothing here yet", "Buy a BLER token and it shows up here."],
    activity: ["pulse|green|No trades yet", "Buys and sells on BLER tokens show up here."],
  }[kind];
  const el = $("#fEmpty");
  if (!m || kind === "loading") { el.hidden = true; return; }
  el.hidden = false;
  const action = kind === "connect" ? `<button type="button" class="btn-launch" data-open-wallet-proxy>Connect wallet</button>`
    : kind === "none" ? `<button type="button" class="btn-launch" data-open-launch>Launch your profile</button>` : "";
  const [icon, tone, title] = m[0].split("|");
  el.innerHTML = `<span class="ei ei-${tone}">${CI[icon]}</span><b>${title}</b><p>${m[1]}</p>${action}`;
}

function currentList() {
  const base = [...localExtras(), ...state.all];
  const q = state.query.trim();
  if (state.view === "search") return q ? sortForYou(base.filter((t) => matches(t, q))) : sortForYou(base);
  if (state.view === "trending") return sortTrending(state.all);
  if (state.view === "holding" || (state.view === "home" && state.tab === "holding")) {
    return sortForYou(state.all.filter((t) => (state.balances.get(t.token) || 0n) > 0n));
  }
  if (state.tab === "new") return sortNew(base);
  return sortForYou(base);
}

// ---------------------------------------------------------------------------
// cinematic bits: entrance once per post, platform stats, live tape, toasts
// ---------------------------------------------------------------------------
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const seenPosts = new Set();
let lastTradeTs = null;

function platformStats() {
  let trades = 0, volume = 0;
  for (const t of state.all) for (const x of tradesOf(t)) { trades++; volume += x.eth || 0; }
  return { tokens: state.all.length, trades, volume };
}

function countTo(el, value, fmt) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = value;
  if (reduced || from === value) { el.textContent = fmt(value); return; }
  const t0 = performance.now(), dur = 1200;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (value - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderHero() {
  const hero = $("#fHero");
  hero.hidden = !(state.view === "home" && state.tab === "foryou");
  if (hero.hidden || !state.all.length) return;
  const st = platformStats();
  countTo(hero.querySelector('[data-stat="tokens"]'), st.tokens, (v) => Math.round(v).toLocaleString("en-US"));
  countTo(hero.querySelector('[data-stat="trades"]'), st.trades, (v) => Math.round(v).toLocaleString("en-US"));
  countTo(hero.querySelector('[data-stat="volume"]'), st.volume, (v) => v.toFixed(v >= 10 ? 1 : 3));
}

function renderTape() {
  const tape = $("#tape");
  const rows = [];
  for (const t of state.all) for (const x of tradesOf(t)) rows.push({ t, x });
  rows.sort((a, b) => (b.x.ts || 0) - (a.x.ts || 0));
  const show = state.view === "home" && rows.length > 0;
  tape.hidden = !show;
  if (!show) return;
  const key = rows.slice(0, 20).map((r) => r.x.hash + r.x.i).join();
  if (tape.dataset.key === key) return; // unchanged — don't restart the scroll
  tape.dataset.key = key;
  const items = rows.slice(0, 20).map(({ t, x }) =>
    `<button type="button" class="ti" data-open="${esc(t.token)}"><span class="side ${x.side}">${x.side === "buy" ? "Buy" : "Sell"}</span><b>$${esc(t.symbol)}</b><span class="mono">${num(x.eth)} ETH</span><span class="muted">${ago(x.ts)}</span></button>`).join("");
  $("#tapeTrack").innerHTML = items + items; // duplicated for a seamless loop
  $("#tapeTrack").style.animationDuration = `${Math.max(20, rows.slice(0, 20).length * 4)}s`;
}

function announceNewTrades() {
  let newest = null;
  for (const t of state.all) for (const x of tradesOf(t)) if (!newest || (x.ts || 0) > (newest.x.ts || 0)) newest = { t, x };
  if (!newest) return;
  if (lastTradeTs != null && newest.x.ts > lastTradeTs + 1000) {
    ui()?.toast(`${short(newest.x.account)} ${newest.x.side === "buy" ? "bought" : "sold"} ${num(newest.x.eth)} ETH of $${newest.t.symbol}`, newest.x.side);
  }
  lastTradeTs = newest.x.ts;
}

// ---------------------------------------------------------------------------
// creator profiles: #/c/<deployer address>
// ---------------------------------------------------------------------------
const CREATOR_HASH = /^#\/c\/(0x[0-9a-fA-F]{40})$/;

function creatorList(addr) {
  const fromIndex = state.all.filter((t) => sameAddr(t.deployer, addr));
  const fromChain = state.creatorTokens.get(addr.toLowerCase()) || [];
  const seen = new Set();
  return [...fromIndex, ...fromChain].filter((t) => visible(t) && (seen.has(t.token) ? false : (seen.add(t.token), true)));
}

async function openCreator(addr, { push = true } = {}) {
  if (!$("#tradeModal").hidden) ui()?.closeModals();
  state.view = "creator";
  state.creator = addr;
  if (push && location.hash !== `#/c/${addr}`) history.replaceState(null, "", `#/c/${addr}`);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  try {
    const mine = (await pons().fetchByDeployer(addr)).filter((t) => t.bler);
    state.creatorTokens.set(addr.toLowerCase(), mine);
    const list = creatorList(addr);
    await loadStats(list);
    render();
    await loadTrades(list);
  } catch {}
  render();
}

function creatorPage() {
  const addr = state.creator;
  const list = creatorList(addr);
  const lead = list[0] || {};
  const handleOf = (t) => t.handle || (t.twitter || "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "").split(/[/?#]/)[0];
  const handle = list.map(handleOf).find((h) => /^[A-Za-z0-9_]{1,30}$/.test(h)) || "";
  const name = handle ? `@${handle}` : short(addr);
  let trades = 0, volume = 0, fees = 0;
  for (const t of list) for (const x of tradesOf(t)) { trades++; volume += x.eth || 0; fees += x.tax || 0; }
  const hue = parseInt(addr.slice(2, 6), 16) % 360;
  const pic = handle ? `<img src="https://unavatar.io/x/${esc(handle)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  const url = `${location.origin}${location.pathname}#/c/${addr}`;
  const share = `https://x.com/intent/post?text=${encodeURIComponent(`${handle ? `@${handle}` : "This creator"} on BLER 🚀 ${list.length} token${list.length === 1 ? "" : "s"} live on Robinhood Chain:`)}&url=${encodeURIComponent(url)}`;
  const loading = !state.creatorTokens.has(addr.toLowerCase());
  return `
  <section class="cprof">
    <div class="cbanner" style="background:radial-gradient(120% 140% at 0% 0%,hsl(${hue} 85% 55% / .55),transparent 60%),radial-gradient(120% 140% at 100% 100%,hsl(${(hue + 90) % 360} 85% 50% / .45),transparent 60%),#0b0d10"></div>
    <div class="chead">
      <div class="cav" style="background:linear-gradient(135deg,hsl(${hue} 80% 60%),hsl(${(hue + 80) % 360} 80% 55%))">${pic}<span>${esc((handle || lead.symbol || "?")[0].toUpperCase())}</span></div>
      <div class="cacts">
        <button type="button" class="ghost-btn sm" data-copy="${esc(url)}">Copy link</button>
        <a class="btn-launch sm" href="${esc(share)}" target="_blank" rel="noopener">Share on 𝕏</a>
      </div>
    </div>
    <div class="cinfo">
      ${handle
        ? `<h2>${esc(name)}</h2><a class="muted" href="https://x.com/${esc(handle)}" target="_blank" rel="noopener">x.com/${esc(handle)} ↗</a><button type="button" class="caddr mono" data-copy="${esc(addr)}" title="Copy wallet">${short(addr)} ⧉</button>`
        : `<button type="button" class="ch2 mono" data-copy="${esc(addr)}" title="Copy wallet">${short(addr)} ⧉</button>`}
      <p class="muted">Creator on BLER · earns ETH on every trade of their tokens.</p>
    </div>
    <div class="cstats">
      <div><b>${list.length}</b><span>Tokens</span></div>
      <div><b>${trades}</b><span>Trades</span></div>
      <div><b>${num(volume)}</b><span>Volume ETH</span></div>
      <div><b class="up">${num(fees)}</b><span>Fees earned ETH</span></div>
    </div>
    <div class="csec">Tokens</div>
  </section>
  ${list.length ? list.map((t, i) => post(t, i)).join("") : `<div class="fempty"><b>${loading ? "Loading…" : "No BLER tokens yet"}</b><p>${loading ? "Reading this creator's launches from Robinhood Chain." : "This wallet hasn't launched on BLER."}</p></div>`}`;
}

window.addEventListener("hashchange", () => {
  const m = location.hash.match(CREATOR_HASH);
  if (m) openCreator(m[1], { push: false });
});

const TITLES = { home: "Home", trending: "Trending", activity: "Activity", holding: "Holding", search: "Search", about: "About", creator: "Profile" };

function render() {
  const posts = $("#posts");
  $("#fTitle").textContent = TITLES[state.view];
  $("#fTabs").hidden = state.view !== "home";
  document.querySelector(".fhead").classList.toggle("tabs-on", state.view === "home");
  $("#mSearch").hidden = state.view !== "search";
  $("#stories").hidden = !(state.view === "home" && state.tab !== "holding");
  $$("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view && !b.classList.contains("brand") && !b.classList.contains("mlogo")));
  $$("#fTabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  $("#fTabs").dataset.active = state.tab;
  const tb = document.querySelector(".tabbar");
  if (tb) tb.dataset.active = ["home", "search", "trending", "activity", "holding"].includes(state.view) ? state.view : "none";

  // stories: most recently active first
  const storyList = sortForYou(state.all).slice(0, 12);
  $("#stories").innerHTML = `<button type="button" class="story" data-open-launch><span class="ring add"><span class="av lg plus">+</span></span><span class="slabel">Launch</span></button>` + storyList.map(story).join("");

  // right column: trending
  $("#trend").innerHTML = sortTrending(state.all).slice(0, 5).map((t) => {
    const st = state.stats.get(t.token) || {};
    return `<button type="button" class="trow" data-open="${esc(t.token)}">${avatar(t, "md")}<span class="tinfo"><b>$${esc(t.symbol)}</b><span class="muted">${t.handle ? `@${esc(t.handle)}` : esc(t.name)}</span></span><b class="${pctCls(st.change)}">${pct(st.change)}</b></button>`;
  }).join("") || '<p class="muted small rpad">No BLER tokens yet.</p>';

  $("#fMore").hidden = !(state.view === "home" && state.tab !== "holding" && state.nextWindow >= 0 && state.all.length);
  renderHero();
  renderTape();

  if (state.view === "about") { posts.innerHTML = ABOUT; empty(null); return; }
  if (state.view === "creator") { posts.innerHTML = creatorPage(); empty(null); return; }
  if (state.loading && !state.all.length) {
    posts.innerHTML = Array.from({ length: 3 }, () => '<div class="post skel"><div class="av"></div><div class="pbody"><i></i><i></i><i class="big"></i></div></div>').join("");
    empty("loading");
    return;
  }
  const w = window.blerWallet;
  if (state.view === "activity") {
    const html = activityRows();
    posts.innerHTML = html;
    empty(html ? null : state.error ? "error" : "activity");
    return;
  }
  const holdingView = state.view === "holding" || (state.view === "home" && state.tab === "holding");
  if (holdingView && !w?.address) { posts.innerHTML = ""; empty("connect"); return; }
  const list = currentList();
  let k = 0;
  posts.innerHTML = list.map((t, i) => {
    const key = t.token || t.hash;
    const html = post(t, i);
    if (reduced || seenPosts.has(key)) return html;
    seenPosts.add(key);
    return html.replace('<article class="post', `<article style="--d:${(k++ * 0.07).toFixed(2)}s" class="enter post`);
  }).join("");
  empty(list.length ? null : state.error ? "error" : state.view === "search" && state.query ? "search" : holdingView ? "holding" : "none");
}

// ---------------------------------------------------------------------------
// interactions
// ---------------------------------------------------------------------------
function setView(v) {
  state.view = v;
  if (v !== "creator" && CREATOR_HASH.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  if (v === "holding") loadBalances().then(render);
  if (v === "activity" || v === "trending") loadTrades(sortForYou(state.all));
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (v === "search") setTimeout(() => $("#mSearch input")?.focus(), 50);
}

document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-view]");
  if (v) { e.preventDefault(); return setView(v.dataset.view); }
  const tab = e.target.closest("#fTabs [data-tab]");
  if (tab) {
    state.tab = tab.dataset.tab;
    if (state.tab === "holding") loadBalances().then(render);
    return render();
  }
  if (e.target.closest("[data-open-wallet-proxy]")) return ui()?.openModal("walletModal");
  const cr = e.target.closest("[data-creator]");
  if (cr) {
    if (cr.dataset.creator) openCreator(cr.dataset.creator);
    else { const tok = cr.closest(".post")?.dataset.token; if (tok) window.blerTrade?.open(tok); }
    return;
  }
  if (e.target.closest("[data-copy]")) {
    const v = e.target.closest("[data-copy]").dataset.copy;
    navigator.clipboard?.writeText(v).then(() => ui()?.toast("Copied"), () => ui()?.toast("Couldn't copy"));
    return;
  }
  const tr = e.target.closest("[data-trade]");
  if (tr) {
    const token = tr.closest(".post")?.dataset.token;
    if (token) window.blerTrade?.open(token, { side: tr.dataset.trade });
    return;
  }
  if (e.target.closest("a")) return; // share links etc.
  const open = e.target.closest("[data-open]");
  if (open?.dataset.open) return window.blerTrade?.open(open.dataset.open);
  const p = e.target.closest(".post");
  if (p && !e.target.closest("button")) {
    if (p.dataset.token) window.blerTrade?.open(p.dataset.token);
    else if (p.dataset.hash) window.open(`${pons().EXPLORER}/tx/${p.dataset.hash}`, "_blank", "noopener");
  }
});

$("#fMore").addEventListener("click", async () => {
  const b = $("#fMore");
  b.disabled = true; b.textContent = "Loading…";
  try { await loadIndex(); await loadStats(state.all); loadTrades(state.all); }
  catch { ui()?.toast("Couldn't load older tokens. Try again"); }
  b.disabled = false; b.textContent = "Load older";
  render();
});

function onSearch(value, submit) {
  const q = value.trim();
  if (submit && /^0x[0-9a-fA-F]{40}$/.test(q)) return window.blerTrade?.open(q);
  state.query = q;
  if (state.view !== "search") state.view = "search";
  render();
}
$("#srch").addEventListener("submit", (e) => { e.preventDefault(); onSearch($("#srch input").value, true); });
$("#srch input").addEventListener("input", (e) => onSearch(e.target.value, false));
$("#mSearch").addEventListener("submit", (e) => { e.preventDefault(); onSearch($("#mSearch input").value, true); });
$("#mSearch input").addEventListener("input", (e) => { state.query = e.target.value; render(); });

// mobile wallet button mirrors the wallet state
function renderMobileWallet() {
  const w = window.blerWallet, b = $("#mWallet");
  if (w?.address) b.textContent = w.address.slice(2, 4).toUpperCase();
  else b.innerHTML = CI.wallet;
  b.classList.toggle("on", !!w?.address);
}
$("#mWallet").addEventListener("click", () => ui()?.openModal("walletModal"));

// sidebar account chip (X-style account switcher)
function renderWalletChip() {
  const w = window.blerWallet, chip = $("#meChip");
  if (!chip) return;
  if (!w?.address) {
    chip.classList.remove("on");
    chip.innerHTML = '<span class="me-av">' + CI.wallet + '</span><span class="me-txt"><b>Connect wallet</b><span class="muted">Tap to connect</span></span>';
    return;
  }
  const ok = w.chainId === pons()?.CHAIN_ID;
  const hue = parseInt(w.address.slice(2, 6), 16) % 360;
  chip.classList.add("on");
  chip.innerHTML = `<span class="me-av" style="background:linear-gradient(135deg,hsl(${hue} 80% 60%),hsl(${(hue + 80) % 360} 80% 55%))">${w.address.slice(2, 4).toUpperCase()}</span><span class="me-txt"><b class="mono">${short(w.address)}</b><span class="${ok ? "up" : "down"}">${ok ? "● Robinhood Chain" : "○ Wrong network"}</span></span><span class="me-dots">⋯</span>`;
}
$("#meChip").addEventListener("click", () => ui()?.openModal("walletModal"));

window.addEventListener("bler:wallet", () => {
  renderMobileWallet();
  renderWalletChip();
  state.balancesFor = null;
  if (state.view === "holding" || state.tab === "holding") loadBalances().then(render);
});
window.addEventListener("bler:launched", (e) => {
  state.highlight = e.detail.token || null;
  render();
  setTimeout(() => refresh(true), 3000);
});

function playIntro() {
  const intro = $("#intro");
  let seen = false;
  try { seen = !!sessionStorage.getItem("bler-intro"); sessionStorage.setItem("bler-intro", "1"); } catch {}
  if (seen || reduced) { intro.remove(); return; }
  intro.classList.add("play");
  // safety net: never leave the intro up if animations are paused
  setTimeout(() => intro.remove(), 2600);
}
playIntro();

function start() {
  const m = location.hash.match(CREATOR_HASH);
  if (m) openCreator(m[1], { push: false });
  renderMobileWallet();
  renderWalletChip();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(true); }, 30000);
}
if (window.blerPons) start();
else window.addEventListener("bler:pons-ready", start, { once: true });
