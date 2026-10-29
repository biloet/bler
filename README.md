# BLER

Launchpad for X and fomo profiles on Robinhood Chain, built on Pons V2.
Static site (HTML/CSS/JS, no build step).

## Run locally

Serve the folder over HTTP (ES modules don't load from `file://`):

```bash
npx serve .
```

## Structure

- `index.html` — page markup
- `styles.css` — styling (dark, cinematic, mobile-first)
- `script.js` — UI, Explore list, wallet connection (EIP-6963 / EIP-1193)
- `pons.js` — Pons V2: launch (`launchToken`), market reads, curve buy/sell with quotes + slippage
- `trade.js` — Buy/Sell panel (opened from Explore or by pasting a token address)
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

The Explore list is stored per browser for now; reading launches from chain
for all visitors is the next step.
