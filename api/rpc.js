// Same-origin JSON-RPC proxy for Robinhood Chain (Vercel serverless function).
// The public RPC answers rate-limited requests (HTTP 429) with a broken CORS
// header ("*,*"), which browsers treat as a network failure. Proxying through
// our own origin removes CORS from the picture and lets us retry 429s here.
const UPSTREAM = "https://rpc.mainnet.chain.robinhood.com";
const RETRY_DELAYS = [250, 700, 1500];
const MAX_BATCH = 50;

// Read-only methods the site needs. Transactions are signed and sent by the
// user's wallet, never through this proxy.
const ALLOWED = new Set([
  "eth_blockNumber", "eth_chainId", "net_version", "eth_call", "eth_getLogs",
  "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getTransactionReceipt",
  "eth_getTransactionByHash", "eth_getTransactionCount", "eth_estimateGas",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rpcError(res, status, id, message) {
  res.status(status).json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32005, message } });
}

module.exports = async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return rpcError(res, 405, null, "POST only");

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return rpcError(res, 400, null, "Invalid JSON"); }
  }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > MAX_BATCH) return rpcError(res, 400, null, "Bad batch size");
  const bad = calls.find((c) => !c || typeof c.method !== "string" || !ALLOWED.has(c.method));
  if (bad) return rpcError(res, 400, bad?.id, `Method not allowed: ${bad?.method}`);

  const payload = JSON.stringify(body);
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    let upstream;
    try {
      upstream = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    } catch {
      upstream = null;
    }
    if (upstream && upstream.status !== 429 && upstream.status < 500) {
      const text = await upstream.text();
      res.setHeader("content-type", "application/json");
      return res.status(upstream.status).send(text);
    }
    if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt]);
  }
  return rpcError(res, 503, Array.isArray(body) ? null : body.id, "Robinhood Chain RPC is busy — try again in a moment");
};
