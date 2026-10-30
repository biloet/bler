// BLER launches index (Vercel serverless function).
//
// GET /api/bler          → newest block window (short CDN cache) + window index
// GET /api/bler?w=<n>    → one fixed block window; finished windows never change,
//                          so they are cached by the CDN for a year
//
// A token counts as a BLER launch when its on-chain description carries the
// marker BLER writes at launch ("… — launched on BLER"). Pons V2 sees ~1,600
// launches a day, so filtering happens here once per window instead of in
// every visitor's browser.
const { createPublicClient, http, parseAbi, getAbiItem } = require("viem");

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const START_BLOCK = 101_000_000n; // no BLER launches exist before this block
const WINDOW = 500_000n; // ~14h of ~0.1s blocks
const SAFE_LAG = 30n; // blocks before a window counts as final
// BLER_MARKER only exists so the filter can be tested against other tokens.
const MARKER = new RegExp(process.env.BLER_MARKER || "launched on BLER", "i");
const CALLS_PER_MULTICALL = 200;
// Tokens hidden from BLER's Explore (they still exist on chain). Lowercase.
const HIDDEN = new Set([
  "0x9991836a0b1c079dbb11af4cdca9c0098f0ff4cd", // $VILO
]);

const chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  contracts: { multicall3: { address: MULTICALL3 } },
};

const abi = parseAbi([
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);
const launchedEvent = getAbiItem({ abi, name: "TokenLaunched" });

const client = createPublicClient({
  chain,
  transport: http(RPC, { retryCount: 4, retryDelay: 500, timeout: 20_000 }),
});

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function scanWindow(w, head) {
  const from = START_BLOCK + BigInt(w) * WINDOW;
  const end = from + WINDOW - 1n;
  const to = end < head ? end : head;
  if (from > head) return { from, to: from - 1n, complete: false, tokens: [] };

  const logs = await client.getLogs({ address: FACTORY, event: launchedEvent, fromBlock: from, toBlock: to });

  // Read descriptions in batches and keep only BLER launches.
  const infos = [];
  for (const part of chunk(logs, CALLS_PER_MULTICALL)) {
    const res = await client.multicall({
      contracts: part.map((l) => ({ address: l.args.token, abi, functionName: "getTokenInfo" })),
      allowFailure: true,
    });
    infos.push(...res);
  }
  const hits = logs
    .map((l, i) => ({ l, info: infos[i]?.status === "success" ? infos[i].result : null }))
    .filter((x) => x.info && MARKER.test(x.info[2] || "") && !HIDDEN.has(x.l.args.token.toLowerCase()));

  let tokens = [];
  if (hits.length) {
    const meta = await client.multicall({
      contracts: hits.flatMap(({ l }) => [
        { address: l.args.token, abi, functionName: "name" },
        { address: l.args.token, abi, functionName: "symbol" },
      ]),
      allowFailure: true,
    });
    const blocks = await Promise.all(
      [...new Set(hits.map(({ l }) => l.blockNumber))].map((n) => client.getBlock({ blockNumber: n }))
    );
    const ts = new Map(blocks.map((b) => [b.number, Number(b.timestamp) * 1000]));
    tokens = hits.map(({ l, info }, i) => {
      const desc = info[2] || "";
      const handle = (desc.match(/@([A-Za-z0-9_.]{1,30})/) || [])[1] || "";
      const platform = /\bon fomo\b/i.test(desc) ? "fomo" : "x";
      return {
        token: l.args.token,
        curve: l.args.curve,
        deployer: l.args.deployer,
        native: l.args.pairToken === "0x0000000000000000000000000000000000000000",
        hash: l.transactionHash,
        block: l.blockNumber.toString(),
        createdAt: ts.get(l.blockNumber) || null,
        name: meta[i * 2]?.result ?? "Unknown",
        symbol: meta[i * 2 + 1]?.result ?? "?",
        logo: info[1] || "",
        handle,
        platform,
        twitter: info[3]?.twitter || "",
      };
    });
    tokens.sort((a, b) => (BigInt(b.block) > BigInt(a.block) ? 1 : -1));
  }
  return { from, to, complete: end <= head - SAFE_LAG, tokens };
}

module.exports = async function handler(req, res) {
  try {
    const head = await client.getBlockNumber();
    const latest = Number((head - START_BLOCK) / WINDOW);
    const q = req.query?.w;
    const w = q === undefined || q === "" ? latest : Number(q);
    if (!Number.isInteger(w) || w < 0 || w > latest) {
      res.setHeader("cache-control", "no-store");
      return res.status(400).json({ error: "bad window", latest });
    }
    const data = await scanWindow(w, head);
    res.setHeader(
      "cache-control",
      data.complete ? "public, max-age=300, s-maxage=31536000, immutable" : "public, max-age=10, s-maxage=20, stale-while-revalidate=60"
    );
    return res.status(200).json({
      window: w,
      latest,
      from: data.from.toString(),
      to: data.to.toString(),
      complete: data.complete,
      tokens: data.tokens,
    });
  } catch (err) {
    res.setHeader("cache-control", "no-store");
    return res.status(503).json({ error: "Robinhood Chain RPC is busy. Try again in a moment" });
  }
};
