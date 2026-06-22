import { WalletUi, createSolanaDevnet, createSolanaLocalnet, createSolanaMainnet, createSolanaTestnet, createWalletUiConfig } from "@wallet-ui/react";
import type { ReactNode } from "react";

export const isDevelopmentEnvironment = import.meta.env.VERCEL_ENV === "development";

const mainnetCluster = createSolanaMainnet(
  import.meta.env.RPC_URL ?? import.meta.env.BUN_PUBLIC_SOLANA_MAINNET_RPC_URL ?? "https://solana-rpc.publicnode.com",
);

export const appClusters = isDevelopmentEnvironment ? [
  createSolanaLocalnet(import.meta.env.BUN_PUBLIC_SOLANA_LOCALNET_RPC_URL ?? "http://127.0.0.1:8899"),
  createSolanaDevnet(import.meta.env.BUN_PUBLIC_SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com"),
  createSolanaTestnet(import.meta.env.BUN_PUBLIC_SOLANA_TESTNET_RPC_URL ?? "https://api.testnet.solana.com"),
  mainnetCluster,
] : [mainnetCluster];

export const defaultCluster = isDevelopmentEnvironment ? appClusters[0]! : mainnetCluster;

export type AppCluster = (typeof appClusters)[number];

const config = createWalletUiConfig({
  clusters: appClusters,
});

export function SolanaProvider({ children }: { children: ReactNode }) {
  return <WalletUi config={config}>{children}</WalletUi>;
}
