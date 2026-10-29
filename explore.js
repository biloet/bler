// Explore: only tokens launched on BLER.
//  - All BLER tokens: from /api/bler, which indexes Pons V2 launches carrying
//    the BLER marker in fixed block windows (finished windows are CDN-cached)
//  - Yours: tokens the connected wallet deployed on Pons V2, BLER ones only
// Launches sent from this browser show up as "confirming" until they land.
const $ = (s) => document.querySelector(s);
const pons = () => window.blerPons;
const LAUNCH_KEY = "bler-launches";
const PAGE_TARGET = 24; // keep loading older windows until we have this many
// Tokens hidden from Explore (they still exist on chain). Keep in sync with api/bler.js.
const HIDDEN = new Set([
  "0x9991836a0b1c079dbb11af4cdca9c0098f0ff4cd", // $VILO
]);
const visible = (t) => !(t.token && HIDDEN.has(t.token.toLowerCase()));

let tab = "all";
let highlight = null;
let loading = false;
const state = {
  all: [], // BLER tokens from the index, newest first
  nextWindow: null, // next (older) window to load; -1 when exhausted
  mine: null,
  mineFor: null,
  stats: new Map(), // token -> { progress, graduated }
  error: false,
};

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GRADS = [["#ff8a00", "#e52e71"], ["#00c6ff", "#0072ff"], ["#7f00ff", "#e100ff"], ["#11998e", "#38ef7d"], ["#f7971e", "#ffd200"], ["#fc466b", "#3f5efb"]];
const timeAgo = (t) => {
  if (!t) return "";
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
const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function card(t) {
  const g = GRADS[(t.symbol || "?").length % GRADS.length];
  const initial = esc((t.symbol || "?")[0]?.toUpperCase());
  const logo = t.logo ? pons()?.ipfsToHttp(t.logo) || "" : "";
  const img = logo ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  const st = state.stats.get(t.token) || t;
  const pending = t.status === "pending";
  const badge = pending ? '<span class="status-draft">Confirming</span>' : "";
  const src = t.handle
    ? `<span class="src src-${t.platform === "fomo" ? "fomo" : "x"}">${t.platform === "fomo" ? "fomo" : "𝕏"}</span> @${esc(t.handle)}`
    : esc(t.name);
  const prog = pending ? "" : st.graduated ? "Graduated" : st.progress != null ? `Curve ${(st.progress * 100).toFixed(1)}%` : "";
  const bar = !pending && st.progress != null && !st.graduated
    ? `<div class="mini-bar"><i style="width:${Math.max(2, st.progress * 100).toFixed(1)}%"></i></div>` : "";
  const key = t.token || t.hash;
  return `
    <div class="p-card card${key && key === highlight ? " just-launched" : ""}" data-token="${esc(t.token || "")}" data-hash="${esc(t.hash || "")}">
      <div class="avatar" style="background:linear-gradient(135deg,${g[0]},${g[1]})">${img}${initial}</div>
      <div class="p-info">
        <div class="p-name">$${esc(t.symbol)} ${badge}</div>
        <div class="p-handle">${src}</div>
        ${bar}
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
  if (kind === "connect") set("👛", "Connect your wallet", "See every token you launched on BLER — from any browser.", "Connect wallet", () => document.querySelector("[data-open-wallet]")?.click());
  else if (kind === "mine") set("🚀", "You haven't launched on BLER yet", "Launch your X or fomo profile — it shows up here as soon as it confirms.", "Launch your profile", openLaunch);
  else if (kind === "error") set("⏳", "Robinhood Chain is busy", "We couldn't load tokens just now. Retrying automatically…", "Retry now", () => refresh(true));
  else set("🚀", "No BLER tokens yet", "Be the first to launch your X or fomo profile.", "Launch your profile", openLaunch);
}

// Launches from this browser the index hasn't picked up yet (pending, or
// confirmed in the last few seconds before the CDN cache refreshes).
function pendingFor(list, addr) {
  const known = new Set(list.flatMap((t) => [t.hash, t.token]).filter(Boolean));
  return localLaunches().filter((t) =>
    (t.status === "pending" || t.status === "live") &&
    !known.has(t.hash) && !(t.token && known.has(t.token)) &&
    (!addr || sameAddr(t.deployer, addr)));
}

function render() {
  const w = window.blerWallet;
  let list;
  if (tab === "all") {
    list = [...pendingFor(state.all), ...state.all];
  } else {
    const chain = state.mineFor && sameAddr(state.mineFor, w?.address) ? state.mine || [] : [];
    list = w?.address ? [...pendingFor(chain, w.address), ...chain] : [];
  }
  list = list.filter(visible);
  const grid = $("#launches");
  if (loading && !list.length) {
    grid.innerHTML = Array.from({ length: 3 }, () => '<div class="p-card card skeleton"></div>').join("");
    showEmpty(null);
  } else {
    grid.innerHTML = list.map(card).join("");
    if (tab === "mine" && !w?.address) showEmpty("connect");
    else if (!list.length) showEmpty(state.error ? "error" : tab);
    else showEmpty(null);
  }
  const more = $("#exMore");
  more.hidden = !(tab === "all" && state.nextWindow != null && state.nextWindow >= 0 && list.length);
  more.disabled = loading;
  more.textContent = loading ? "Loading…" : "Load older";
  $("#exNote").textContent = tab === "mine" && w?.address
    ? `BLER tokens deployed by ${w.address.slice(0, 6)}…${w.address.slice(-4)}.`
    : "";
}

async function fetchWindow(w) {
  const url = w == null ? "/api/bler" : `/api/bler?w=${w}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`index ${r.status}`);
  return r.json();
}

// Load windows newest → oldest until we have PAGE_TARGET more tokens or run out.
async function loadAll({ reset = false } = {}) {
  let collected = [];
  let next;
  if (reset || state.nextWindow == null) {
    const first = await fetchWindow(null);
    collected = first.tokens;
    next = first.window - 1;
  } else {
    next = state.nextWindow;
  }
  while (next >= 0 && collected.length < PAGE_TARGET) {
    const page = await fetchWindow(next);
    collected = collected.concat(page.tokens);
    next -= 1;
  }
  const merged = reset || state.nextWindow == null ? collected : state.all.concat(collected);
  const seen = new Set();
  state.all = merged.filter((t) => (seen.has(t.token) ? false : (seen.add(t.token), true)));
  state.nextWindow = next;
}

async function refreshStats(list) {
  const want = list.filter((t) => t.token && t.curve);
  if (!want.length) return;
  try {
    const stats = await pons().fetchCurveStats(want);
    stats.forEach((v, k) => state.stats.set(k, v));
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

async function refresh(force = false) {
  if (!pons()) return;
  const w = window.blerWallet;
  loading = true;
  state.error = false;
  render();
  try {
    const changed = await resolvePending();
    if (tab === "all") {
      if (force || changed || state.nextWindow == null) await loadAll({ reset: true });
      await refreshStats(state.all);
    } else if (w?.address) {
      if (force || changed || !sameAddr(state.mineFor, w.address)) {
        const mine = await pons().fetchByDeployer(w.address);
        state.mine = mine.filter((t) => t.bler);
        state.mineFor = w.address;
      }
      await refreshStats(state.mine || []);
    }
    refresh.retries = 0;
  } catch (err) {
    console.warn("Explore load failed", err);
    state.error = true;
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

$("#exMore").addEventListener("click", async () => {
  if (loading) return;
  loading = true;
  render();
  try {
    await loadAll();
    await refreshStats(state.all);
  } catch {
    window.blerUI?.toast("Couldn't load older tokens — try again");
  } finally {
    loading = false;
    render();
  }
});

$("#launches").addEventListener("click", (e) => {
  const el = e.target.closest(".p-card");
  if (!el || el.classList.contains("skeleton")) return;
  if (el.dataset.token) return window.blerTrade?.open(el.dataset.token);
  if (el.dataset.hash) {
    window.blerUI?.toast("Still confirming — opening the transaction");
    window.open(`${pons().EXPLORER}/tx/${el.dataset.hash}`, "_blank", "noopener");
  }
});

// A launch from this browser: show it right away and highlight it
window.addEventListener("bler:launched", (e) => {
  highlight = e.detail.token || e.detail.hash;
  state.mineFor = null;
  render();
  // the index may lag a few seconds behind the receipt; reload shortly after
  setTimeout(() => refresh(true), 3000);
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
  setInterval(() => { if (!document.hidden && !loading) refresh(true); }, 30000);
}
if (window.blerPons) start();
else window.addEventListener("bler:pons-ready", start, { once: true });
