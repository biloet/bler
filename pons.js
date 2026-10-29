// Pons V2 launch integration (Robinhood Chain).
// ABI and addresses match the Pons V2 factory as used by public integrations
// (pons-bundler, LOCKEY). Every launch reads live factory state and simulates
// the call before asking the wallet to sign.
import {
  createPublicClient, createWalletClient, custom, parseAbi, parseEventLogs,
  formatEther, zeroAddress, BaseError, ContractFunctionRevertedError,
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

const FRIENDLY = {
  NotWhitelisted: "This wallet isn't allowed to launch on Pons V2 yet — launching is gated by Pons.",
  LaunchFeeNotPaid: "The launch fee wasn't paid in full. Try again.",
  CreatorTaxTooHigh: "Creator fee is above the Pons V2 limit. Pick a lower fee.",
  LaunchEconomicsMismatch: "Pons updated its curve settings a moment ago. Try again.",
  LaunchConfigDisabled: "Pons has paused this launch type right now.",
  PairTokenNotApproved: "ETH pairing isn't enabled on Pons right now.",
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

function clients(provider) {
  const transport = custom(provider);
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
export async function launchToken({ provider, account, name, symbol, handle, platform, creatorTaxBps, onStep = () => {} }) {
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

window.blerPons = { readStatus, launchToken, LaunchError, EXPLORER, CHAIN_ID };
window.dispatchEvent(new Event("bler:pons-ready"));
