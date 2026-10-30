// Shared server-side chain reads for share previews (not a route: "_" prefix).
const { createPublicClient, http, parseAbi, getAbiItem } = require("viem");

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const LOG_SPAN = 9_900_000n;

const client = createPublicClient({
  chain: {
    id: 4663, name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  },
  transport: http(RPC, { retryCount: 3, retryDelay: 400, timeout: 15_000 }),
});

const abi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
]);
const ev = (name) => getAbiItem({ abi, name });

const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");
const ipfsToHttp = (u) => (!u ? "" : u.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + u.slice(7) : /^https?:\/\//.test(u) ? u : "");
const handleOf = (desc, twitter) => {
  const m = (desc || "").match(/@([A-Za-z0-9_]{1,30})/);
  if (m) return m[1];
  const t = (twitter || "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,30}$/.test(t) ? t : "";
};

/** Everything a share card needs. Throws if the address isn't a launch. */
async function tokenCard(token, { withChart = true } = {}) {
  const lt = await client.readContract({ address: FACTORY, abi, functionName: "getLaunchedToken", args: [token] });
  if (!lt.exists) throw new Error("not a launch");
  const r = (address, functionName) => ({ address, abi, functionName });
  const [name, symbol, supply, info, reserves, real, thr, grad] = (await client.multicall({
    contracts: [r(token, "name"), r(token, "symbol"), r(token, "totalSupply"), r(token, "getTokenInfo"), r(lt.curve, "getReserves"), r(lt.curve, "realQuoteReserve"), r(lt.curve, "graduationThreshold"), r(lt.curve, "graduated")],
    allowFailure: true,
  })).map((x) => (x.status === "success" ? x.result : null));

  const sup = Number(supply || 0n) / 1e18;
  const price = reserves ? Number(reserves[0]) / 1e18 / (Number(reserves[1]) / 1e18) : 0;
  const launchPrice = reserves && real != null ? Number(reserves[0] - real) / 1e18 / sup : 0;
  const card = {
    token, curve: lt.curve, deployer: lt.deployer,
    name: name || "Unknown", symbol: symbol || "?",
    logo: ipfsToHttp(info?.[1] || ""), description: info?.[2] || "",
    handle: handleOf(info?.[2], info?.[3]?.twitter),
    priceEth: price, mcapEth: price * sup, launchPrice,
    change: launchPrice > 0 ? price / launchPrice - 1 : 0,
    progress: real != null && thr ? Math.min(1, Number((real * 10000n) / thr) / 10000) : 0,
    graduated: !!grad, trades: 0, prices: [],
  };
  if (!withChart) return card;

  // launch block, then buys/sells (one event per query: 10M-block limit)
  const head = await client.getBlockNumber();
  let from = null;
  for (let i = 0n, to = head; i < 10n && to > 0n; i++, to -= LOG_SPAN) {
    const lo = to > LOG_SPAN ? to - LOG_SPAN + 1n : 0n;
    const [log] = await client.getLogs({ address: FACTORY, event: ev("TokenLaunched"), args: { token }, fromBlock: lo, toBlock: to });
    if (log) { from = log.blockNumber; break; }
  }
  if (from == null) from = head > LOG_SPAN ? head - LOG_SPAN : 0n;
  let logs = [];
  for (let lo = from; lo <= head; lo += LOG_SPAN) {
    const hi = lo + LOG_SPAN - 1n < head ? lo + LOG_SPAN - 1n : head;
    const parts = await Promise.all(["CurveBuy", "CurveSell"].map((n) => client.getLogs({ address: lt.curve, event: ev(n), fromBlock: lo, toBlock: hi })));
    logs = logs.concat(...parts);
  }
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const prices = [launchPrice];
  for (const l of logs) {
    const a = l.args, buy = l.eventName === "CurveBuy";
    const tokens = Number(buy ? a.tokensOut : a.tokensIn) / 1e18;
    const eth = Number(buy ? a.quoteIn - a.fee - a.tax : a.quoteOut + a.fee + a.tax) / 1e18;
    if (tokens > 0) prices.push(eth / tokens);
  }
  prices.push(price);
  card.trades = logs.length;
  card.prices = prices.filter((p) => p > 0);
  return card;
}

function fmt(n) {
  if (!isFinite(n) || n == null) return "—";
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

module.exports = { tokenCard, isAddress, fmt };
