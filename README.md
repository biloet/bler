# BLER

Launchpad for X and fomo profiles on Robinhood Chain, built on Pons V2.
Static site (HTML/CSS/JS, no build step).

## Run locally

The page is static, but Explore and the RPC proxy are Vercel functions in
`api/` (they need `npm install` for viem). The simplest way to run everything:

```bash
npm install
npx vercel dev
```

## Structure

- `index.html` — page markup
- `styles.css` — styling (dark, cinematic, mobile-first)
- `script.js` — UI, Explore list, wallet connection (EIP-6963 / EIP-1193)
- `pons.js` — Pons V2: launch (`launchToken`), market reads, curve buy/sell with quotes + slippage
- `trade.js` — token page: chart, trades, Buy/Sell, Share on X; shareable at `#/t/<token address>`
- `api/rpc.js` — Vercel serverless JSON-RPC proxy (read-only allowlist, retries 429s)
- `api/bler.js` — Vercel function indexing BLER launches per 500k-block window (finished windows CDN-cached for a year)
- `explore.js` — Explore: BLER tokens only (all / yours), market cap, change since launch, sparklines, sort
- `hero.js` — hero showcase cycling through the most active BLER tokens with their real chart
- `assets/vendor/viem-2.21.0.js` — bundled [viem](https://viem.sh) 2.21.0 (ESM)
- `assets/logo.svg` — BLER logo

## Pons V2

| | |
|---|---|
| Chain | Robinhood Chain, ID `4663` |
| Factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Launch | `launchToken(TokenParams, 0, address(0) /* ETH */, [])` with `value = launchFee()` |

The factory ABI matches public Pons V2 integrations (pons-bundler, LOCKEY);
Pons has not published an official ABI. It was verified against mainnet
(block 101070906): `launchEnabled = true`, `canLaunch` open, `launchFee =
0.0005 ETH`, `maxCreatorTaxBps = 1000`, and a `launchToken` call built by
`pons.js` simulates successfully. `canLaunch` is still checked on every launch
in case Pons gates it again.

Buy/sell trades on the bonding curve (phase 0, ETH pairs). Quotes use the
curve's constant-product math minus curve + creator fees; every trade is
simulated before signing. Selling approves the exact amount first if needed.
Verified against mainnet with the SwapMeet ($MEET) curve.

Explore shows only tokens launched on BLER. BLER writes a marker into the
token's on-chain description ("@handle on X — launched on BLER");
`/api/bler` scans `TokenLaunched` logs in fixed block windows starting at block
101,000,000, reads descriptions through Multicall3 and returns the BLER ones.
Finished windows never change and are cached by the CDN; only the newest
window is refreshed (~20 s). Curve progress is read live in the browser.

Browser reads go through `/api/rpc` first: the public RPC answers rate-limited
requests (HTTP 429) with a duplicated CORS header (`*,*`) that browsers
reject, so the same-origin proxy avoids CORS and retries 429s server-side.
Fallbacks: public RPC directly, then the connected wallet.
