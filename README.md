# Handshake

Peer-to-peer token swaps on Solana.

Powered by [Vector](https://github.com/blueshift-gg/vector).

Maker authorization is signed with Falcon-512, a post-quantum signature mechanism.

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

## Local Surfnet Workflow

This workflow runs the full Vector PDA swap flow locally:

- Start a mainnet-backed Surfpool Surfnet on `http://127.0.0.1:8899`.
- Let Surfpool auto-deploy the Vector program from `target/deploy`.
- Let Surfpool resolve SPL mints and existing token accounts from mainnet on demand.
- Run the app against Surfnet.
- Create a swap link as the maker, then open it as the taker and take the swap.

### Prerequisites

Install dependencies:

```bash
bun install
```

Install Surfpool once if it is not already on your `PATH`:

```bash
curl -sL https://run.surfpool.run/ | bash
```

Install the Solana CLI if it is not already available:

```bash
solana --version
```

Surfpool airdrops local SOL to your local Solana keypair at `~/.config/solana/id.json`. To use another payer keypair:

```bash
export SOLANA_KEYPAIR=/path/to/id.json
```

### 1. Start Surfnet

Run this in terminal 1 and keep it running:

```bash
bun run surfnet
```

This starts local RPC at `http://127.0.0.1:8899` and WebSocket at `ws://127.0.0.1:8900`.

Surfpool loads the Vector artifact from `target/deploy/vector_ed25519.so` with program id:

```text
EMeHQpaeoU3NN679YimZWVxvaSeWqDHMKafcDxGWGRrY
```

### 2. Start The App

Optionally fund your Surfnet maker and taker accounts in terminal 2:

```bash
bun run surfnet:fund --case-1|--case-2|--case-3 <maker-wallet-address> <taker-wallet-address>
```

This airdrops local SOL to both wallets and funds any non-SOL source token accounts needed for the swap. It uses Surfpool cheatcodes against local Surfnet only; it does not clone or create local mints.

Examples:

```bash
# 1. Maker SOL for taker USDC.
bun run surfnet:fund --case-1 <maker-wallet-address> <taker-wallet-address>

# 2. Maker USDC for taker SOL.
bun run surfnet:fund --case-2 <maker-wallet-address> <taker-wallet-address>

# 3. Maker USDC for taker USDT.
bun run surfnet:fund --case-3 <maker-wallet-address> <taker-wallet-address>
```

When a side uses wrapped SOL, the app uses native SOL from that wallet and wraps only the required amount during the signed flow. When the maker uses a non-SOL token, `surfnet:fund` funds the maker Vector PDA token account because that is the token authority used by the swap.

Start the app in terminal 3:

```bash
bun run dev:surfnet
```

Open the app at the Vite URL, usually:

```text
http://localhost:3000
```

### 3. Create And Take A Swap

Maker flow:

1. Connect the maker wallet.
2. Keep cluster set to `Localnet`.
3. Enter the taker wallet address.
4. Use the preselected mainnet tokens or search for a token by symbol or mint address.
5. Enter maker send amount and taker send amount.
6. Click `Create swap link`.

The first maker click initializes the maker Vector PDA if it does not exist, then signs the Vector digest and creates the swap link.

Taker flow:

1. Open the generated `/swap/<swapId>` link.
2. Connect the taker wallet.
3. Review the maker/taker addresses, token addresses, and amounts.
4. Click `Take swap`.

Surfnet is backed by mainnet, so Surfpool fetches mint and account data from mainnet instead of requiring local clone or seed steps. Use `surfnet:fund` when you need local-only balances for test wallets.

### Wallet Requirements

For Surfnet, the wallet must either:

- Support `signTransaction`, so the app can submit the signed transaction to `http://127.0.0.1:8899`.
- Or be configured inside the wallet extension to use custom RPC `http://127.0.0.1:8899`.

If the wallet only exposes `signAndSendTransaction` while pointed at devnet/mainnet, it may fail with:

```text
Blockhash not found
```

### Local Database

Swap links are stored in Postgres via `DATABASE_URL`. For local Postgres, disable SSL:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/handshake
export DATABASE_SSL=false
bun run db:push
```

### Useful Checks

Verify Surfpool deployed the local Vector program:

```bash
bun --eval 'import { Connection, Address } from "@solana/web3.js"; const c = new Connection("http://127.0.0.1:8899", "confirmed"); const info = await c.getAccountInfo(new Address("EMeHQpaeoU3NN679YimZWVxvaSeWqDHMKafcDxGWGRrY")); console.log(info && { executable: info.executable, owner: info.owner.toString(), lamports: info.lamports, dataLength: info.data.length });'
```

### Common Errors

`This program may not be used for executing instructions`

Restart Surfpool with the mainnet-backed script:

```bash
bun run surfnet
```

`Blockhash not found`

Use a wallet that supports `signTransaction`, or configure the wallet's custom RPC to `http://127.0.0.1:8899`.

`owner.toBuffer is not a function`

Restart the dev server. The app includes compatibility shims for `@solana/web3.js@3.0.0-rc.1` and `@solana/spl-token@0.4.14`, but the browser needs the latest bundle.

`Transaction results in an account with insufficient funds for rent`

Rerun the app after pulling the latest code. Vector initialization now tops up the Vector PDA rent in the same transaction.

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
