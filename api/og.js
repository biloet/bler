// Share-card image for a token: GET /api/og?t=<token address> → 1200×630 PNG.
// Used as og:image / twitter:image by /t/<address> (api/t.js).
const fs = require("fs");
const path = require("path");
const { tokenCard, isAddress, fmt } = require("./_chain.js");

const W = 1200, H = 630;
const LOGO = "data:image/svg+xml;base64," + fs.readFileSync(path.join(__dirname, "..", "assets", "logo.svg")).toString("base64");
const XICON = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#71767b" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>').toString("base64");
const GRADS = [["#ff8a00", "#e52e71"], ["#00c6ff", "#0072ff"], ["#7f00ff", "#e100ff"], ["#11998e", "#38ef7d"], ["#f7971e", "#ffd200"], ["#fc466b", "#3f5efb"]];

// tiny hyperscript for satori (no JSX build step)
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((c) => c != null && c !== false) } });
const img = (src, style) => ({ type: "img", props: { src, style } });

async function fetchImage(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "BLER-preview" } });
    clearTimeout(t);
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !/^image\/(png|jpe?g|gif|webp|svg\+xml)/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function chartSvg(prices, up) {
  const w = 1080, hgt = 200, p = 8;
  const col = up ? "#00ba7c" : "#f91880";
  if (prices.length < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><line x1="${p}" y1="${hgt / 2}" x2="${w - p}" y2="${hgt / 2}" stroke="#2f3336" stroke-width="4" stroke-dasharray="14 12"/></svg>`;
  }
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo) { hi *= 1.05; lo *= 0.95; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const pts = prices.map((v, i) => [p + (i / (prices.length - 1)) * (w - 2 * p), hgt - p - ((v - lo) / (hi - lo)) * (hgt - 2 * p)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${pts.at(-1)[0]},${hgt} L${pts[0][0]},${hgt} Z" fill="url(#g)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function stat(label, value, color = "#e7e9ea") {
  return h("div", { flexDirection: "column", padding: "16px 22px", borderRadius: 20, border: "2px solid #2f3336", background: "rgba(22,24,28,.75)", minWidth: 210 },
    h("div", { fontSize: 22, color: "#71767b" }, label),
    h("div", { fontSize: 40, fontWeight: 700, color, marginTop: 4 }, value));
}

module.exports = async function handler(req, res) {
  const token = String(req.query?.t || "");
  if (!isAddress(token)) { res.status(400).send("bad token"); return; }
  const { ImageResponse } = await import("@vercel/og");
  let c;
  try {
    c = await tokenCard(token);
  } catch {
    res.setHeader("cache-control", "public, s-maxage=60");
    res.status(404).send("not found");
    return;
  }
  const logo = await fetchImage(c.logo || (c.handle ? `https://unavatar.io/x/${c.handle}` : ""));
  const g = GRADS[c.symbol.length % GRADS.length];
  const flat = Math.abs(c.change) < 0.0005;
  const up = c.change >= 0;
  const changeTxt = flat ? "0.0%" : `${up ? "+" : ""}${(c.change * 100).toFixed(1)}%`;
  const changeCol = flat ? "#71767b" : up ? "#00ba7c" : "#f91880";
  const chart = "data:image/svg+xml;base64," + Buffer.from(chartSvg(c.prices, c.prices.at(-1) >= c.prices[0])).toString("base64");

  const avatar = logo
    ? img(logo, { width: 132, height: 132, borderRadius: 66, objectFit: "cover", border: "4px solid #000" })
    : h("div", { width: 132, height: 132, borderRadius: 66, alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 700, color: "#fff", backgroundImage: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }, c.symbol[0].toUpperCase());

  const tree = h("div", {
      width: W, height: H, flexDirection: "column", padding: "48px 60px", color: "#e7e9ea", fontFamily: "sans-serif",
      backgroundColor: "#000",
      backgroundImage: "radial-gradient(circle at 12% 0%, rgba(29,155,240,.45), transparent 45%), radial-gradient(circle at 95% 100%, rgba(0,186,124,.32), transparent 45%)",
    },
    h("div", { alignItems: "center", gap: 28 },
      h("div", { padding: 5, borderRadius: 75, backgroundImage: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }, avatar),
      h("div", { flexDirection: "column", flex: 1 },
        h("div", { fontSize: 60, fontWeight: 700, letterSpacing: -1 }, c.name.slice(0, 22)),
        h("div", { fontSize: 32, color: "#71767b", marginTop: 6, gap: 16 },
          h("span", { color: "#1d9bf0", fontWeight: 700 }, `$${c.symbol}`),
          c.handle ? h("span", { alignItems: "center", gap: 10 }, img(XICON, { width: 26, height: 26 }), `@${c.handle}`) : null)),
      h("div", { flexDirection: "column", alignItems: "flex-end" },
        h("div", { fontSize: 22, color: "#71767b" }, "Price"),
        h("div", { fontSize: 44, fontWeight: 700 }, `${fmt(c.priceEth)} ETH`))),
    h("div", { marginTop: 26, height: 200 }, img(chart, { width: 1080, height: 200 })),
    h("div", { marginTop: 24, gap: 16, alignItems: "flex-end" },
      stat("Market cap", `${fmt(c.mcapEth)} ETH`),
      stat("Since launch", changeTxt, changeCol),
      stat("Trades", String(c.trades)),
      h("div", { flex: 1, justifyContent: "flex-end", alignItems: "center", gap: 14 },
        img(LOGO, { width: 56, height: 56, borderRadius: 14 }),
        h("div", { flexDirection: "column" },
          h("div", { fontSize: 30, fontWeight: 700, letterSpacing: 8 }, "BLER"),
          h("div", { fontSize: 20, color: "#71767b" }, "Trade on Robinhood Chain")))));

  const out = new ImageResponse(tree, { width: W, height: H });
  const buf = Buffer.from(await out.arrayBuffer());
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  res.status(200).send(buf);
};
