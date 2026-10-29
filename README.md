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
- `pons.js` — Pons V2 launch: reads factory state, simulates, sends `launchToken`
- `assets/vendor/viem-2.21.0.js` — bundled [viem](https://viem.sh) 2.21.0 (ESM)
- `assets/logo.svg` — BLER logo

## Pons V2

| | |
|---|---|
| Chain | Robinhood Chain, ID `4663` |
| Factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Launch | `launchToken(TokenParams, 0, address(0) /* ETH */, [])` with `value = launchFee()` |

The factory ABI matches public Pons V2 integrations (pons-bundler, LOCKEY);
Pons has not published an official ABI. Launching is gated by
`canLaunch(address)` — wallets Pons hasn't allowed will see a clear message
and no transaction is sent.

The Explore list is stored per browser for now; reading launches from chain
for all visitors is the next step.
