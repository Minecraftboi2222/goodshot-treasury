# GOODSHOT automatic treasury

This is a continuously running Node service. The website hosts the durable transaction outbox and verifies finalized Solana transactions. No signer secret is stored in the website, repository, logs, or browser. The public playtest stays usable while money features await setup.

## Selected wallets and funding

- Manual-donation destination (70%): `6JhLT2mZmF5NMGcRrSw26XoHFmdrFQmxTY9rVSCgnag5`
- Dedicated prize treasury and service signer (30%): `GKZCRudVWUWNbEN7uvY1CREJEoGc9onZmuNuzpU6X77p`
- Token mint: awaiting launch.

After launch, configure Pump creator distribution through Proxima: exactly these two wallets, 70% / 30%. These are fee recipients, not token holders. Pump sharing updates can revoke the admin permanently; inspect the exact addresses and percentages in your wallet before signing. This service never creates or changes that configuration. If the token uses a different route, cashback, or a non-SOL quote, it halts rather than inventing a funding source.

The service checks the sharing configuration and triggers Pump distribution using the official SDK. SOL reaches each wallet on chain. Only confirmed distribution transfers for the configured mint credit the ledger. The donation figure means transferred to your manual-donation wallet, not donated to a charity. Each round reserves 10% of the remaining prize pool; the top three receive 50% / 30% / 20% automatically after an eligible round.

## Hosting and secrets

Deploy one always-on background service on an account you control. A Docker-capable host can build from the project root with `automation/Dockerfile`; an ordinary Node 24 background worker can use `npm ci` and `npm run treasury:worker`. It is separate from Sites web hosting and must remain running. Do not use a browser tab or your laptop as the production scheduler. Configure automatic process restart and persistence is handled by the site's D1 outbox.

Private service variables:

| Variable | Value |
| --- | --- |
| GOODSHOT_ORIGIN | `https://playgoodshot.fun` |
| SOLANA_RPC_URL | Reliable mainnet HTTPS RPC, including transaction-history access |
| TREASURY_KEYPAIR_PATH | Preferred: path to a privately mounted Solana keypair JSON file |
| TREASURY_SECRET_KEY | Alternative: encrypted host secret containing the treasury keypair JSON or base58 secret; never paste into chat |
| CLAIM_LOOKUP_TABLE | Optional Solana address lookup table for larger claim transactions |
| MIN_CLAIM_LAMPORTS | Default `1000000` (0.001 SOL gross threshold) |
| GAS_RESERVE_LAMPORTS | Default `20000000` (0.02 SOL minimum extra reserve) |

Fund the treasury with a separate gas cushion above its prize liabilities, for example 0.05 SOL. This deposit is not credited as fees or prize money. The runner pauses new transactions if backing falls below all unpaid/available prize allocations plus the reserve. A transaction's estimated network fee must be at most 0.00005 SOL. Claims are checked at most once per minute; pending payments are checked approximately every 10 seconds. Failed RPC requests back off on that loop.

Site environment values (public configuration, set through Sites):

- `GAME_TREASURY_WALLET`: selected prize wallet above, already saved.
- `TOKEN_MINT`: launched mainnet mint, still needed.
- `SOLANA_NETWORK`: `mainnet-beta`.
- `SOLANA_RPC_URL` / `FEE_RPC_URL`: reliable verification RPC, credentials configured as secrets.
- `AUTOMATION_ENABLED`: `true` only once the distribution, signer, funding and service are verified.

The site authenticates the service with short-lived, one-use Ed25519 request signatures bound to the exact origin, endpoint and body. No shared API password is needed. The server accepts payout transactions only when their recipients and amounts exactly match an unpaid settled round and their memo binds them to that round.

## Retries and verification

Before broadcasting, the site commits the signed transaction, signature and blockhash expiry to D1. A unique database constraint allows only one in-flight transaction, including across two service instances. Restarts rebroadcast the same saved bytes. A new payout signature is permitted only after the old signature has finalized with an error or a finalized chain height has passed its validity window and history contains no transaction. Mere HTTP timeout does not authorize replacement. Confirmed payments decrement the reserved balance exactly once.

Unexpected successful transactions requiring review remain recorded; their payout job cannot be replaced automatically. Signed outbox bytes stay behind service authentication. The public panel shows service heartbeat and payment signatures, never secret material. Review discrepancies before activating mainnet; do not reset D1 while liabilities exist.

Verification uses mocked RPC data and generated test wallets; no mainnet funds have been claimed or paid. A small real claim and a small eligible end-to-end payout must still be verified after configuration. Larger fee sweeps may require `CLAIM_LOOKUP_TABLE`; the runner pauses with a setup message if a transaction cannot fit, rather than sending a partial distribution.

The official SDK's transitive dependency audit currently reports upstream advisories. The container disables install scripts/native bigint bindings; the service does not parse TOML, expose JSON-RPC server parsers, or use UUID buffer-writing functions. These are containment measures, not an audit certification. Recheck dependencies and the live integration before enabling meaningful balances.
