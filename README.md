# bun-react-tailwind-shadcn-template

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

## Local Surfnet workflow

Install Surfpool once if it is not already on your `PATH`:

```bash
curl -sL https://run.surfpool.run/ | bash
```

Start a local Surfnet with the Vector Ed25519 program deployed from `target/deploy`:

```bash
bun run surfnet
```

In a second terminal, explicitly deploy the Vector Ed25519 program to Surfnet:

```bash
bun run surfnet:deploy-vector
```

Then seed local swap mints and token accounts for the browser wallets you will use:

```bash
bun run surfnet:seed <maker-wallet-address> <taker-wallet-address>
```

Start the app with the token env file written by the seed command:

```bash
source .surfpool/local-token-env.sh
bun run dev:surfnet
```

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
