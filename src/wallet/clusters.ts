import { createSolanaDevnet, createSolanaLocalnet, createSolanaMainnet, createSolanaTestnet } from "@wallet-ui/react";

export const appClusters = [
  createSolanaLocalnet(import.meta.env.BUN_PUBLIC_SOLANA_LOCALNET_RPC_URL ?? "http://127.0.0.1:8899"),
  createSolanaDevnet(import.meta.env.BUN_PUBLIC_SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com"),
  createSolanaTestnet(import.meta.env.BUN_PUBLIC_SOLANA_TESTNET_RPC_URL ?? "https://api.testnet.solana.com"),
  createSolanaMainnet(
    import.meta.env.RPC_URL ?? import.meta.env.BUN_PUBLIC_SOLANA_MAINNET_RPC_URL ?? "https://solana-rpc.publicnode.com",
  ),
];

export const defaultCluster = appClusters[0]!;

export type AppCluster = (typeof appClusters)[number];
