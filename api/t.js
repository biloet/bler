// Share page for a token: /t/<address> (rewritten here by vercel.json).
// Crawlers (X, Telegram, Discord…) read the Open Graph tags and the card
// image from /api/og; people are sent straight to the token in the app.
const { tokenCard, isAddress, fmt } = require("./_chain.js");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async function handler(req, res) {
  const token = String(req.query?.addr || "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "bler-iota.vercel.app";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const origin = `${proto}://${host}`;
  if (!isAddress(token)) {
    res.setHeader("location", "/");
    return res.status(302).send("");
  }
  const appUrl = `/#/t/${token}`;
  let title = "BLER — Your clout. Now a market.";
  let desc = "Launch your 𝕏 or fomo profile as a token on Robinhood Chain.";
  try {
    const c = await tokenCard(token, { withChart: false });
    const ch = Math.abs(c.change) < 0.0005 ? "" : ` · ${c.change >= 0 ? "+" : ""}${(c.change * 100).toFixed(1)}% since launch`;
    title = `$${c.symbol} — ${c.name}${c.handle ? ` (@${c.handle})` : ""} on BLER`;
    desc = `Market cap ${fmt(c.mcapEth)} ETH${ch}. Trade it on Robinhood Chain.`;
  } catch {}
  const image = `${origin}/api/og?t=${token}`;
  const url = `${origin}/t/${token}`;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  res.status(200).send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BLER">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)})</script>
<style>body{background:#000;color:#e7e9ea;font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}a{color:#1d9bf0}</style>
</head><body><a href="${esc(appUrl)}">Open ${esc(title)}</a></body></html>`);
};
