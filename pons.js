// Pons V2 launch integration (Robinhood Chain).
// ABI and addresses match the Pons V2 factory as used by public integrations
// (pons-bundler, LOCKEY). Every launch reads live factory state and simulates
// the call before asking the wallet to sign.
import {
  createPublicClient, createWalletClient, custom, http, fallback, parseAbi, parseEventLogs,
  formatEther, formatUnits, zeroAddress, BaseError, ContractFunctionRevertedError,
} from "./assets/vendor/viem-2.21.0.js";

export const CHAIN_ID = 4663;
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const LAUNCH_CONFIG_ID = 0n; // standard fixed-supply curve
const NATIVE_ETH = zeroAddress; // pair with native ETH

const chain = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
};

const factoryAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function canLaunch(address launcher) view returns (bool)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "error LaunchFeeNotPaid()",
  "error NotWhitelisted()",
  "error CreatorTaxTooHigh()",
  "error LaunchEconomicsMismatch()",
  "error PairTokenNotApproved()",
  "error PairTokenDecimalsMismatch()",
  "error ExemptionListTooLong()",
  "error LaunchConfigDisabled()",
]);

const curveAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function isNativeQuote() view returns (bool)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
  "error CurveGraduated()",
  "error SlippageExceeded()",
  "error NativeValueMismatch()",
  "error UnexpectedNativeValue()",
  "error ZeroAmount()",
]);

const tokenAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

const FRIENDLY = {
  NotWhitelisted: "This wallet isn't allowed to launch on Pons V2 yet — launching is gated by Pons.",
  LaunchFeeNotPaid: "The launch fee wasn't paid in full. Try again.",
  CreatorTaxTooHigh: "Creator fee is above the Pons V2 limit. Pick a lower fee.",
  LaunchEconomicsMismatch: "Pons updated its curve settings a moment ago. Try again.",
  LaunchConfigDisabled: "Pons has paused this launch type right now.",
  PairTokenNotApproved: "ETH pairing isn't enabled on Pons right now.",
  SlippageExceeded: "Price moved more than your slippage. Try again or raise slippage.",
  CurveGraduated: "This token has graduated to Uniswap V4 — it no longer trades on the curve.",
  ZeroAmount: "Enter an amount greater than zero.",
};

export class LaunchError extends Error {}

function friendly(err) {
  if (err instanceof LaunchError) return err;
  if (err?.code === 4001 || /user (rejected|denied)/i.test(err?.message || "")) {
    return new LaunchError("You rejected the request in your wallet.");
  }
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = revert?.data?.errorName;
    if (name) return new LaunchError(FRIENDLY[name] || `Pons V2 rejected the launch (${name}).`);
    if (/insufficient funds/i.test(err.message)) return new LaunchError("Not enough ETH for the launch fee plus gas.");
    return new LaunchError(err.shortMessage || err.message);
  }
  return new LaunchError(err?.message || "Unknown error");
}

// Reads without a wallet: our own /api/rpc proxy first (same origin, retries
// rate limits), then the public RPC directly. Requests are batched.
const PROXY_URL = new URL("/api/rpc", location.origin).href;
const batch = { batchSize: 25, wait: 20 };
function readTransports() {
  return [
    http(PROXY_URL, { batch, retryCount: 1, retryDelay: 600 }),
    http(chain.rpcUrls.default.http[0], { batch, retryCount: 2, retryDelay: 800 }),
  ];
}

function clients(provider) {
  const transport = provider ? custom(provider) : fallback(readTransports());
  return {
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ chain, transport }),
  };
}

function randomSalt() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Read the live Pons V2 factory state for this wallet. */
export async function readStatus(provider, account) {
  const { publicClient } = clients(provider);
  const code = await publicClient.getBytecode({ address: FACTORY });
  if (!code || code === "0x") throw new LaunchError("Pons V2 factory not found on this network. Switch to Robinhood Chain.");
  const read = (functionName, args) => publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName, args });
  const [launchEnabled, canLaunch, launchFee, maxCreatorTaxBps, config] = await Promise.all([
    read("launchEnabled"),
    read("canLaunch", [account]),
    read("launchFee"),
    read("maxCreatorTaxBps"),
    read("getLaunchConfig", [LAUNCH_CONFIG_ID]),
  ]);
  return { launchEnabled, canLaunch, launchFee, maxCreatorTaxBps, configEnabled: config.enabled, launchFeeEth: formatEther(launchFee) };
}

/**
 * Launch a token through the Pons V2 factory.
 * onStep(text) reports progress for the UI.
 */
export async function launchToken({ provider, account, name, symbol, handle, platform, creatorTaxBps, onStep = () => {}, onSent = () => {} }) {
  try {
    const { publicClient, walletClient } = clients(provider);

    onStep("Checking Pons V2…");
    const status = await readStatus(provider, account);
    if (!status.launchEnabled) throw new LaunchError("Pons V2 launches are paused right now.");
    if (!status.configEnabled) throw new LaunchError(FRIENDLY.LaunchConfigDisabled);
    if (!status.canLaunch) throw new LaunchError(FRIENDLY.NotWhitelisted);
    if (BigInt(creatorTaxBps) > status.maxCreatorTaxBps) {
      throw new LaunchError(`Creator fee is above the Pons V2 limit (${Number(status.maxCreatorTaxBps) / 100}%).`);
    }

    const expectedEconomics = await publicClient.readContract({
      address: FACTORY, abi: factoryAbi, functionName: "previewLaunchEconomics", args: [LAUNCH_CONFIG_ID, NATIVE_ETH],
    });

    const isX = platform === "x";
    const params = {
      name,
      symbol,
      logo: isX ? `https://unavatar.io/x/${handle}` : "",
      description: `@${handle} on ${isX ? "X" : "fomo"} — launched on BLER`,
      socials: {
        twitter: isX ? `https://x.com/${handle}` : "",
        telegram: "",
        discord: "",
        website: location.origin,
        farcaster: "",
      },
      creatorFeeRecipient: account,
      creatorTaxBps: Number(creatorTaxBps),
      buybackEnabled: false,
      expectedEconomics,
      salt: randomSalt(),
    };

    onStep("Simulating launch…");
    const { request } = await publicClient.simulateContract({
      account,
      address: FACTORY,
      abi: factoryAbi,
      functionName: "launchToken",
      args: [params, LAUNCH_CONFIG_ID, NATIVE_ETH, []],
      value: status.launchFee,
    });

    onStep(`Confirm in your wallet (fee ${status.launchFeeEth} ETH)…`);
    const hash = await walletClient.writeContract(request);
    onSent(hash);

    onStep("Waiting for Robinhood Chain…");
    const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1500, timeout: 180_000 });
    if (receipt.status !== "success") throw new LaunchError("The launch transaction reverted.");

    const [log] = parseEventLogs({ abi: factoryAbi, eventName: "TokenLaunched", logs: receipt.logs });
    if (!log) throw new LaunchError("Launched, but the TokenLaunched event was missing. Check the transaction on Blockscout.");

    return { hash, token: log.args.token, curve: log.args.curve, launchFee: status.launchFeeEth };
  } catch (err) {
    throw friendly(err);
  }
}

// ---------------------------------------------------------------------------
// Trading on the bonding curve (phase 0, native-ETH pairs)
// Quote math mirrors the curve: constant product on reserves, fees outside.
// ---------------------------------------------------------------------------
const BPS = 10_000n;
const amountOut = (inAmt, rIn, rOut) => (inAmt <= 0n ? 0n : (inAmt * rOut) / (rIn + inAmt));
const amountIn = (outAmt, rIn, rOut) => (outAmt * rIn) / (rOut - outAmt) + 1n;
export const applySlippage = (amt, bps) => (bps >= BPS ? 0n : (amt * (BPS - BigInt(bps))) / BPS);

function ipfsToHttp(url) {
  if (!url) return "";
  if (url.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + url.slice(7);
  return /^https?:\/\//.test(url) ? url : "";
}

/** Everything the trade panel needs about a token, read live from chain. */
export async function getMarket(token, { provider, account } = {}) {
  try {
    const { publicClient } = clients(provider);
    const lt = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] });
    if (!lt.exists) throw new LaunchError("That address isn't a Pons V2 token.");
    const curve = lt.curve;
    const rc = (address, abi, functionName, args) => publicClient.readContract({ address, abi, functionName, args });
    const [name, symbol, decimals, totalSupply, info, reserves, realQuote, sellable, feeBps, creatorTaxBps, threshold, graduated, native] = await Promise.all([
      rc(token, tokenAbi, "name"),
      rc(token, tokenAbi, "symbol"),
      rc(token, tokenAbi, "decimals"),
      rc(token, tokenAbi, "totalSupply"),
      rc(token, tokenAbi, "getTokenInfo").catch(() => null),
      rc(curve, curveAbi, "getReserves"),
      rc(curve, curveAbi, "realQuoteReserve"),
      rc(curve, curveAbi, "sellableTokens"),
      rc(curve, curveAbi, "feeBps"),
      rc(curve, curveAbi, "creatorTaxBps"),
      rc(curve, curveAbi, "graduationThreshold"),
      rc(curve, curveAbi, "graduated"),
      rc(curve, curveAbi, "isNativeQuote"),
    ]);
    let balance = 0n, allowance = 0n, ethBalance = 0n, snipeBps = 0n;
    if (account) {
      [balance, allowance, ethBalance, snipeBps] = await Promise.all([
        rc(token, tokenAbi, "balanceOf", [account]),
        rc(token, tokenAbi, "allowance", [account, curve]),
        publicClient.getBalance({ address: account }),
        rc(curve, curveAbi, "currentSnipeTaxBps", [account]),
      ]);
    }
    const [quoteReserve, tokenReserve] = reserves;
    const scale = 10n ** BigInt(decimals);
    // price in ETH per whole token (float, display only)
    const priceEth = (Number(quoteReserve) / 1e18) / (Number(tokenReserve) / Number(scale));
    return {
      token, curve, name, symbol, decimals: Number(decimals), totalSupply,
      logo: ipfsToHttp(info?.[1] || ""), description: info?.[2] || "", socials: info?.[3] || null,
      quoteReserve, tokenReserve, realQuote, sellable, feeBps, creatorTaxBps, snipeBps, threshold,
      tradable: lt.phase === 0 && !graduated, native, phase: lt.phase,
      priceEth, mcapEth: priceEth * Number(totalSupply) / Number(scale),
      progress: threshold > 0n ? Math.min(1, Number(realQuote * 10000n / threshold) / 10000) : 0,
      balance, allowance, ethBalance,
    };
  } catch (err) {
    throw friendly(err);
  }
}

/** Expected tokens for ethIn (wei) on the curve, including fees, snipe tax and the sellable cap. */
export function quoteBuy(m, ethIn) {
  if (ethIn <= 0n) return { tokensOut: 0n, spent: 0n };
  let snipe = m.snipeBps;
  const maxSnipe = BPS - m.feeBps - m.creatorTaxBps - 100n;
  if (snipe > maxSnipe) snipe = maxSnipe < 0n ? 0n : maxSnipe;
  const net = ethIn - (ethIn * m.feeBps) / BPS - (ethIn * m.creatorTaxBps) / BPS - (ethIn * snipe) / BPS;
  let tokensOut = amountOut(net, m.quoteReserve, m.tokenReserve);
  let spent = ethIn;
  if (tokensOut > m.sellable) {
    tokensOut = m.sellable;
    const needNet = amountIn(m.sellable, m.quoteReserve, m.tokenReserve);
    const denom = BPS - m.feeBps - m.creatorTaxBps - snipe;
    const gross = (needNet * BPS + denom - 1n) / denom;
    spent = gross < ethIn ? gross : ethIn;
  }
  return { tokensOut, spent, snipeBps: snipe };
}

/** Expected ETH (wei) for selling tokensIn on the curve, after fees. */
export function quoteSell(m, tokensIn) {
  if (tokensIn <= 0n) return { ethOut: 0n };
  const gross = amountOut(tokensIn, m.tokenReserve, m.quoteReserve);
  return { ethOut: gross - (gross * m.feeBps) / BPS - (gross * m.creatorTaxBps) / BPS };
}

function assertTradable(m) {
  if (!m.tradable) throw new LaunchError(FRIENDLY.CurveGraduated);
  if (!m.native) throw new LaunchError("This token is paired with an ERC-20, not ETH. BLER trades ETH pairs only for now.");
}

export async function buy({ provider, account, market: m, ethIn, slippageBps, onStep = () => {} }) {
  try {
    assertTradable(m);
    const { publicClient, walletClient } = clients(provider);
    const q = quoteBuy(m, ethIn);
    if (q.tokensOut === 0n) throw new LaunchError(FRIENDLY.ZeroAmount);
    const minOut = applySlippage(q.tokensOut, slippageBps);
    onStep("Simulating buy…");
    const { request, result } = await publicClient.simulateContract({
      account, address: m.curve, abi: curveAbi, functionName: "buy", args: [ethIn, minOut, account], value: ethIn,
    });
    onStep("Confirm the buy in your wallet…");
    const hash = await walletClient.writeContract(request);
    onStep("Waiting for Robinhood Chain…");
    const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 120_000 });
    if (receipt.status !== "success") throw new LaunchError("The buy transaction reverted.");
    return { hash, tokensOut: result };
  } catch (err) {
    throw friendly(err);
  }
}

export async function sell({ provider, account, market: m, tokensIn, slippageBps, onStep = () => {} }) {
  try {
    assertTradable(m);
    if (tokensIn <= 0n) throw new LaunchError(FRIENDLY.ZeroAmount);
    if (tokensIn > m.balance) throw new LaunchError(`You only hold ${formatUnits(m.balance, m.decimals)} ${m.symbol}.`);
    const { publicClient, walletClient } = clients(provider);
    const allowance = await publicClient.readContract({ address: m.token, abi: tokenAbi, functionName: "allowance", args: [account, m.curve] });
    if (allowance < tokensIn) {
      onStep(`Step 1/2 — approve ${m.symbol} for selling in your wallet…`);
      const approveHash = await walletClient.writeContract({
        account, chain, address: m.token, abi: tokenAbi, functionName: "approve", args: [m.curve, tokensIn],
      });
      onStep("Waiting for approval…");
      const r = await publicClient.waitForTransactionReceipt({ hash: approveHash, pollingInterval: 1000, timeout: 120_000 });
      if (r.status !== "success") throw new LaunchError("The approval transaction reverted.");
    }
    const q = quoteSell(m, tokensIn);
    const minOut = applySlippage(q.ethOut, slippageBps);
    onStep("Simulating sell…");
    const { request, result } = await publicClient.simulateContract({
      account, address: m.curve, abi: curveAbi, functionName: "sell", args: [tokensIn, minOut, account],
    });
    onStep(allowance < tokensIn ? "Step 2/2 — confirm the sell in your wallet…" : "Confirm the sell in your wallet…");
    const hash = await walletClient.writeContract(request);
    onStep("Waiting for Robinhood Chain…");
    const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 120_000 });
    if (receipt.status !== "success") throw new LaunchError("The sell transaction reverted.");
    return { hash, ethOut: result };
  } catch (err) {
    throw friendly(err);
  }
}

// ---------------------------------------------------------------------------
// Explore: read launches straight from chain (public RPC, works without a wallet)
// ---------------------------------------------------------------------------
const LOG_SPAN = 9_900_000n; // RPC allows 10M blocks per getLogs
const launchedEvent = factoryAbi.find((x) => x.type === "event" && x.name === "TokenLaunched");
// Proxy, then public RPC; if both fail fall back to the connected wallet's own
// RPC when it's on Robinhood Chain.
function readClient() {
  const w = window.blerWallet;
  const transports = readTransports();
  if (w?.provider && w.address && w.chainId === CHAIN_ID) transports.push(custom(w.provider));
  return createPublicClient({ chain, transport: fallback(transports) });
}

async function describeLaunches(c, logs) {
  if (!logs.length) return [];
  const head = await c.getBlock();
  const calls = logs.flatMap((l) => [
    { address: l.args.token, abi: tokenAbi, functionName: "name" },
    { address: l.args.token, abi: tokenAbi, functionName: "symbol" },
    { address: l.args.token, abi: tokenAbi, functionName: "getTokenInfo" },
    { address: l.args.curve, abi: curveAbi, functionName: "realQuoteReserve" },
    { address: l.args.curve, abi: curveAbi, functionName: "graduationThreshold" },
    { address: l.args.curve, abi: curveAbi, functionName: "graduated" },
  ]);
  const res = await c.multicall({ contracts: calls, allowFailure: true });
  const BLOCK_MS = 104; // ~0.1s blocks; good enough for "x minutes ago"
  return logs.map((l, i) => {
    const r = res.slice(i * 6, i * 6 + 6).map((x) => (x.status === "success" ? x.result : null));
    const info = r[2];
    const desc = info?.[2] || "";
    return {
      token: l.args.token, curve: l.args.curve, deployer: l.args.deployer, hash: l.transactionHash,
      native: l.args.pairToken === zeroAddress,
      name: r[0] ?? "Unknown", symbol: r[1] ?? "?", logo: ipfsToHttp(info?.[1] || ""), description: desc,
      twitter: info?.[3]?.twitter || "",
      handle: (desc.match(/@([A-Za-z0-9_.]{1,30})/) || [])[1] || "",
      platform: /\bon fomo\b/i.test(desc) ? "fomo" : "x",
      bler: /launched on BLER/i.test(desc),
      graduated: !!r[5],
      progress: r[3] != null && r[4] ? Math.min(1, Number((r[3] * 10000n) / r[4]) / 10000) : null,
      createdAt: Number(head.timestamp) * 1000 - Number(head.number - l.blockNumber) * BLOCK_MS,
    };
  });
}

/** Newest Pons V2 launches (all launchpads). */
export async function fetchLatest({ limit = 24, lookback = 150_000n } = {}) {
  const c = readClient();
  const head = await c.getBlockNumber();
  const logs = await c.getLogs({ address: FACTORY, event: launchedEvent, fromBlock: head - lookback, toBlock: head });
  logs.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1));
  return describeLaunches(c, logs.slice(0, limit));
}

/** Every Pons V2 token deployed by this wallet (scans back ~3 months). */
export async function fetchByDeployer(deployer, { chunks = 10, limit = 60 } = {}) {
  const c = readClient();
  const head = await c.getBlockNumber();
  let logs = [];
  for (let i = 0n, to = head; i < BigInt(chunks) && to > 0n; i++, to -= LOG_SPAN) {
    const from = to > LOG_SPAN ? to - LOG_SPAN + 1n : 0n;
    logs = logs.concat(await c.getLogs({ address: FACTORY, event: launchedEvent, args: { deployer }, fromBlock: from, toBlock: to }));
  }
  logs.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1));
  return describeLaunches(c, logs.slice(0, limit));
}

// ---------------------------------------------------------------------------
// Trades on a curve (for the chart and the trade list)
// CurveBuy: quoteIn is gross ETH; CurveSell: quoteOut is net ETH. Execution
// price on the curve = ETH that actually hit the curve / tokens.
// ---------------------------------------------------------------------------
const tradeEvents = curveAbi.filter((x) => x.type === "event");

async function findLaunchBlock(c, token, head) {
  for (let i = 0n, to = head; i < 10n && to > 0n; i++, to -= LOG_SPAN) {
    const from = to > LOG_SPAN ? to - LOG_SPAN + 1n : 0n;
    const [log] = await c.getLogs({ address: FACTORY, event: launchedEvent, args: { token }, fromBlock: from, toBlock: to });
    if (log) return log.blockNumber;
  }
  return head > LOG_SPAN ? head - LOG_SPAN : 0n;
}

/**
 * Trades for a market. Pass `since` (a previous result) to fetch only new ones.
 * Returns { launchBlock, launchTs, toBlock, trades: [{ side, account, eth, tokens, price, block, ts, hash }] }
 */
export async function fetchTrades(m, since) {
  const c = readClient();
  const headBlock = await c.getBlock();
  const head = headBlock.number;
  const headTs = Number(headBlock.timestamp) * 1000;
  let launchBlock = since?.launchBlock, launchTs = since?.launchTs;
  if (launchBlock == null) {
    launchBlock = await findLaunchBlock(c, m.token, head);
    launchTs = Number((await c.getBlock({ blockNumber: launchBlock })).timestamp) * 1000;
  }
  const fromBlock = since ? since.toBlock + 1n : launchBlock;
  let logs = [];
  for (let from = fromBlock; from <= head; from += LOG_SPAN) {
    const to = from + LOG_SPAN - 1n < head ? from + LOG_SPAN - 1n : head;
    logs = logs.concat(await c.getLogs({ address: m.curve, events: tradeEvents, fromBlock: from, toBlock: to }));
  }
  // timestamps: interpolate between launch block and head (blocks are ~0.1s)
  const span = Number(head - launchBlock) || 1;
  const tsOf = (b) => launchTs + ((headTs - launchTs) * Number(b - launchBlock)) / span;
  const scale = 10 ** m.decimals;
  const trades = logs.map((l) => {
    const a = l.args;
    const buy = l.eventName === "CurveBuy";
    const tokens = Number(buy ? a.tokensOut : a.tokensIn) / scale;
    const ethGross = Number(buy ? a.quoteIn : a.quoteOut + a.fee + a.tax) / 1e18;
    const ethNet = Number(buy ? a.quoteIn - a.fee - a.tax : a.quoteOut + a.fee + a.tax) / 1e18;
    return {
      side: buy ? "buy" : "sell",
      account: buy ? a.recipient : a.seller,
      eth: buy ? ethGross : Number(a.quoteOut) / 1e18,
      tokens,
      price: tokens > 0 ? ethNet / tokens : 0,
      block: l.blockNumber,
      ts: tsOf(l.blockNumber),
      hash: l.transactionHash,
      i: l.logIndex,
    };
  }).filter((t) => t.tokens > 0);
  return {
    launchBlock, launchTs, toBlock: head, headTs,
    trades: (since?.trades || []).concat(trades),
  };
}

/** Live curve state for a list of tokens: Map(token -> { progress, graduated }). */
export async function fetchCurveStats(items) {
  const out = new Map();
  if (!items.length) return out;
  const c = readClient();
  const res = await c.multicall({
    contracts: items.flatMap((t) => [
      { address: t.curve, abi: curveAbi, functionName: "realQuoteReserve" },
      { address: t.curve, abi: curveAbi, functionName: "graduationThreshold" },
      { address: t.curve, abi: curveAbi, functionName: "graduated" },
    ]),
    allowFailure: true,
  });
  items.forEach((t, i) => {
    const [real, thr, grad] = res.slice(i * 3, i * 3 + 3).map((x) => (x.status === "success" ? x.result : null));
    out.set(t.token, {
      graduated: !!grad,
      progress: real != null && thr ? Math.min(1, Number((real * 10000n) / thr) / 10000) : null,
    });
  });
  return out;
}

/** Resolve a launch tx hash: { status: "pending" | "failed" | "live", token? }. */
export async function checkLaunchTx(hash) {
  const c = readClient();
  const receipt = await c.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return { status: "pending" };
  if (receipt.status !== "success") return { status: "failed" };
  const [log] = parseEventLogs({ abi: factoryAbi, eventName: "TokenLaunched", logs: receipt.logs });
  return log ? { status: "live", token: log.args.token, curve: log.args.curve } : { status: "failed" };
}

window.blerPons = { readStatus, launchToken, fetchTrades, fetchLatest, fetchByDeployer, fetchCurveStats, ipfsToHttp, checkLaunchTx, getMarket, quoteBuy, quoteSell, buy, sell, applySlippage, LaunchError, EXPLORER, CHAIN_ID };
window.dispatchEvent(new Event("bler:pons-ready"));
