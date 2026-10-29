// Explore: Pons V2 launches read from Robinhood Chain.
//  - Latest: newest launches on the factory (everyone sees these)
//  - Your tokens: everything the connected wallet deployed, plus launches sent
//    from this browser that are still confirming
const $ = (s) => document.querySelector(s);
const pons = () => window.blerPons;
const LAUNCH_KEY = "bler-launches";

let tab = "latest";
let highlight = null;
let loading = false;
const cache = { latest: null, mine: null, mineFor: null };

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GRADS = [["#ff8a00", "#e52e71"], ["#00c6ff", "#0072ff"], ["#7f00ff", "#e100ff"], ["#11998e", "#38ef7d"], ["#f7971e", "#ffd200"], ["#fc466b", "#3f5efb"]];
const timeAgo = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const localLaunches = () => {
  try { return (JSON.parse(localStorage.getItem(LAUNCH_KEY)) || []).filter((t) => t.hash); } catch { return []; }
};
const saveLocal = (list) => { try { localStorage.setItem(LAUNCH_KEY, JSON.stringify(list)); } catch {} };

function card(t) {
  const g = GRADS[(t.symbol || "?").length % GRADS.length];
  const initial = esc((t.symbol || "?")[0]?.toUpperCase());
  const avatar = t.logo
    ? `<div class="avatar" style="background:linear-gradient(135deg,${g[0]},${g[1]})"><img src="${esc(t.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">${initial}</div>`
    : `<div class="avatar" style="background:linear-gradient(135deg,${g[0]},${g[1]})">${initial}</div>`;
  const badge = t.status === "pending"
    ? '<span class="status-draft">Confirming</span>'
    : t.bler ? '<span class="status-live">BLER</span>' : "";
  const prog = t.status === "pending" ? "" : t.graduated ? "Graduated" : t.progress != null ? `Curve ${(t.progress * 100).toFixed(1)}%` : "";
  const progBar = t.progress != null && !t.graduated && t.status !== "pending"
    ? `<div class="mini-bar"><i style="width:${Math.max(2, t.progress * 100).toFixed(1)}%"></i></div>` : "";
  const key = t.token || t.hash;
  return `
    <div class="p-card card${key && key === highlight ? " just-launched" : ""}" data-token="${esc(t.token || "")}" data-hash="${esc(t.hash || "")}">
      ${avatar}
      <div class="p-info">
        <div class="p-name">$${esc(t.symbol)} ${badge}</div>
        <div class="p-handle">${esc(t.name)}</div>
        ${progBar}
      </div>
      <div class="p-right">
        <div class="p-time">${timeAgo(t.createdAt)}</div>
        <div class="p-creator">${esc(prog)}</div>
      </div>
    </div>`;
}

function showEmpty(kind) {
  const el = $("#launchesEmpty");
  el.hidden = !kind;
  if (!kind) return;
  const btn = $("#emptyBtn");
  const set = (icon, title, text, label, action) => {
    $("#emptyIcon").textContent = icon;
    $("#emptyTitle").textContent = title;
    $("#emptyText").textContent = text;
    btn.textContent = label;
    btn.onclick = action;
  };
  const openLaunch = () => document.querySelector("[data-open-launch]")?.click();
  if (kind === "connect") set("👛", "Connect your wallet", "See every token your wallet launched on Pons V2 — from any browser.", "Connect wallet", () => document.querySelector("[data-open-wallet]")?.click());
  else if (kind === "mine") set("🚀", "No tokens from this wallet yet", "Launch your X or fomo profile — it shows up here as soon as it confirms.", "Launch your profile", openLaunch);
  else if (kind === "error") set("⏳", "Robinhood Chain is busy", "We couldn't load tokens just now. Retrying automatically…", "Retry now", () => refresh(true));
  else set("🚀", "No launches in the last few hours", "Be the first — launch your profile.", "Launch your profile", openLaunch);
}

function render() {
  const grid = $("#launches");
  const w = window.blerWallet;
  let list = [];
  if (tab === "latest") {
    list = cache.latest || [];
  } else {
    const chain = cache.mineFor && cache.mineFor === w?.address ? cache.mine || [] : [];
    const known = new Set(chain.map((t) => t.hash));
    const pending = localLaunches().filter((t) => t.status === "pending" && !known.has(t.hash) &&
      (!w?.address || t.deployer?.toLowerCase() === w.address.toLowerCase()));
    list = [...pending, ...chain];
  }
  grid.innerHTML = list.map(card).join("");
  if (loading && !list.length) {
    grid.innerHTML = Array.from({ length: 3 }, () => '<div class="p-card card skeleton"></div>').join("");
    showEmpty(null);
  } else if (tab === "mine" && !w?.address && !list.length) showEmpty("connect");
  else if (!list.length) showEmpty(cache.error ? "error" : tab === "mine" ? "mine" : "latest");
  else showEmpty(null);
  $("#exNote").textContent = tab === "latest"
    ? "Showing the newest launches on the Pons V2 factory across all launchpads. Tokens launched on BLER carry the BLER badge."
    : w?.address ? `Tokens deployed by ${w.address.slice(0, 6)}…${w.address.slice(-4)} on Pons V2 (last ~3 months).` : "";
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

async function refresh(force = false) {
  if (!pons()) return;
  const w = window.blerWallet;
  loading = true;
  cache.error = false;
  render();
  try {
    if (tab === "latest") {
      if (force || !cache.latest) cache.latest = await pons().fetchLatest();
    } else if (w?.address) {
      const changed = await resolvePending();
      if (force || changed || cache.mineFor !== w.address) {
        cache.mine = await pons().fetchByDeployer(w.address);
        cache.mineFor = w.address;
      }
    }
    refresh.retries = 0;
  } catch (err) {
    console.warn("Explore load failed", err);
    cache.error = true;
    // back off and retry a few times (rate limits clear within seconds)
    refresh.retries = (refresh.retries || 0) + 1;
    if (refresh.retries <= 4) setTimeout(() => refresh(true), 2000 * refresh.retries);
  } finally {
    loading = false;
    render();
  }
}

function setTab(next) {
  tab = next;
  document.querySelectorAll("[data-ex]").forEach((b) => b.classList.toggle("active", b.dataset.ex === tab));
  refresh();
}

document.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.ex)));

$("#launches").addEventListener("click", (e) => {
  const el = e.target.closest(".p-card");
  if (!el || el.classList.contains("skeleton")) return;
  if (el.dataset.token) return window.blerTrade?.open(el.dataset.token);
  if (el.dataset.hash) {
    window.blerUI?.toast("Still confirming — opening the transaction");
    window.open(`${pons().EXPLORER}/tx/${el.dataset.hash}`, "_blank", "noopener");
  }
});

// A launch from this browser: jump to "Your tokens" and highlight it
window.addEventListener("bler:launched", (e) => {
  highlight = e.detail.token || e.detail.hash;
  cache.mineFor = null; // force reload from chain
  setTab("mine");
  if (e.detail.status === "pending") return;
  // the RPC may lag a block behind the receipt; retry once shortly after
  setTimeout(() => refresh(true), 2500);
});

let lastAddr = null;
window.addEventListener("bler:wallet", () => {
  const a = window.blerWallet?.address || null;
  if (a === lastAddr) return;
  lastAddr = a;
  if (tab === "mine") refresh();
});

function start() {
  refresh();
  // keep it fresh while the page is open
  setInterval(() => { if (!document.hidden) refresh(true); }, 30000);
}
if (window.blerPons) start();
else window.addEventListener("bler:pons-ready", start, { once: true });
