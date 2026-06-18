# Handshake Solana Wallet

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

- Start a Surfpool Surfnet on `http://127.0.0.1:8899`.
- Deploy the Vector Ed25519 program from `target/deploy`.
- Create local SPL mints and token accounts for your maker/taker wallets.
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

The deploy and seed scripts use your local Solana keypair at `~/.config/solana/id.json` as the payer. To use another payer keypair:

```bash
export SOLANA_KEYPAIR=/path/to/id.json
```

### 1. Start Surfnet

Run this in terminal 1 and keep it running:

```bash
bun run surfnet
```

This starts local RPC at `http://127.0.0.1:8899` and WebSocket at `ws://127.0.0.1:8900`.

### 2. Deploy Vector

Run this in terminal 2:

```bash
bun run surfnet:deploy-vector
```

Expected program id:

```text
EMeHQpaeoU3NN679YimZWVxvaSeWqDHMKafcDxGWGRrY
```

The app sets `VECTOR_PROGRAM` to this id in `bun run dev:surfnet`.

### 3. Seed Tokens

Use the browser wallet addresses you will use for the maker and taker:

```bash
bun run surfnet:seed <maker-wallet-address> <taker-wallet-address>
```

Example:

```bash
bun run surfnet:seed HWKDDmWEWeEmrhAdLx7hv3y5C7Hnp2KJYyMoTdb722dg 1yr11wi9My98QoAvn5mCxUciatiNv9eaNhQRoWq8Ef5
```

This script:

- Airdrops SOL to the payer, maker, and taker on Surfnet.
- Creates two local SPL mints.
- Creates token accounts for the maker Vector PDA and taker wallet.
- Mints local token A to the maker Vector PDA token account.
- Mints local token B to the taker token account.
- Writes `.surfpool/local-token-env.sh` with the local mint addresses.

### 4. Start The App

Start the app with the token env file written by the seed command:

```bash
source .surfpool/local-token-env.sh
bun run dev:surfnet
```

Open the app at the Vite URL, usually:

```text
http://localhost:3000
```

### 5. Create And Take A Swap

Maker flow:

1. Connect the maker wallet.
2. Keep cluster set to `Localnet`.
3. Enter the taker wallet address.
4. Use the preselected local tokens from the seed step.
5. Enter maker send amount and taker send amount.
6. Click `Create swap link`.

The first maker click initializes the maker Vector PDA if it does not exist, then signs the Vector digest and creates the swap link.

Taker flow:

1. Open the generated `/swap/<swapId>` link.
2. Connect the taker wallet.
3. Review the maker/taker addresses, token addresses, and amounts.
4. Click `Take swap`.

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

Verify Vector is deployed and executable:

```bash
bun --eval 'import { Connection, Address } from "@solana/web3.js"; const c = new Connection("http://127.0.0.1:8899", "confirmed"); const info = await c.getAccountInfo(new Address("EMeHQpaeoU3NN679YimZWVxvaSeWqDHMKafcDxGWGRrY")); console.log(info && { executable: info.executable, owner: info.owner.toString(), lamports: info.lamports, dataLength: info.data.length });'
```

Verify the seed env exists:

```bash
cat .surfpool/local-token-env.sh
```

### Common Errors

`This program may not be used for executing instructions`

Run:

```bash
bun run surfnet:deploy-vector
```

`Blockhash not found`

Use a wallet that supports `signTransaction`, or configure the wallet's custom RPC to `http://127.0.0.1:8899`.

`owner.toBuffer is not a function`

Restart the dev server. The app includes compatibility shims for `@solana/web3.js@3.0.0-rc.1` and `@solana/spl-token@0.4.14`, but the browser needs the latest bundle.

`Transaction results in an account with insufficient funds for rent`

Rerun the app after pulling the latest code. Vector initialization now tops up the Vector PDA rent in the same transaction.

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
