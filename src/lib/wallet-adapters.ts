import { getWallets } from "@wallet-standard/app";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import type { UiWallet } from "@wallet-ui/react";
import type { Transaction } from "@solana/web3.js";

export type LegacySolanaProvider = {
  connect: () => Promise<{ publicKey?: string | { toString(): string } }>;
  disconnect?: () => Promise<void>;
  publicKey?: string | { toString(): string };
  signMessage?: (message: Uint8Array, display?: string) => Promise<{ signature?: Uint8Array }>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (transaction: Transaction) => Promise<{ signature?: string }>;
};

export function getRegisteredWallet(walletName: string | undefined) {
  if (!walletName) return undefined;
  return getWallets().get().find((registeredWallet) => registeredWallet.name === walletName);
}

export function getLegacySolanaProvider(walletName: string | undefined): LegacySolanaProvider | undefined {
  const win = window as typeof window & {
    backpack?: LegacySolanaProvider | { solana?: LegacySolanaProvider };
    jupiter?: LegacySolanaProvider | { solana?: LegacySolanaProvider };
    solana?: LegacySolanaProvider;
  };
  const normalized = walletName?.toLowerCase() ?? "";
  if (normalized.includes("backpack")) return getNestedSolanaProvider(win.backpack);
  if (normalized.includes("jupiter")) return getNestedSolanaProvider(win.jupiter);
  if (normalized.includes("phantom")) return win.solana;
}

export async function connectStandardWallet(wallet: UiWallet) {
  const standardWallet = getRegisteredWallet(wallet.name);
  const connectFeature = standardWallet?.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined;
  if (!standardWallet || !connectFeature) throw new Error("Wallet extension was detected, but its connect feature is unavailable. Refresh the page and try again.");

  const result = await connectFeature.connect();
  const account = result.accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? result.accounts[0];
  if (!account?.address) throw new Error("The wallet did not return a Solana account.");

  return account.address;
}

export async function connectLegacyWallet(wallet: UiWallet) {
  const provider = getLegacySolanaProvider(wallet.name);
  if (!provider) throw new Error("Wallet extension is unavailable.");

  const result = await provider.connect();
  const publicKey = result?.publicKey ?? provider.publicKey;
  const address = typeof publicKey === "string" ? publicKey : publicKey?.toString();
  if (!address) throw new Error("The wallet did not return a public key.");

  return address;
}

export async function getCurrentWalletAddress(walletName: string) {
  const standardWallet = getRegisteredWallet(walletName);
  const standardAccount = standardWallet?.accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? standardWallet?.accounts[0];
  if (standardAccount?.address) return standardAccount.address;
  const connectFeature = standardWallet?.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined;

  try {
    const result = await connectFeature?.connect({ silent: true });
    const account = result?.accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? result?.accounts[0];
    if (account?.address) return account.address;
  } catch {
    // Some wallets do not support silent reconnect; fall through to extension state.
  }

  const publicKey = getLegacySolanaProvider(walletName)?.publicKey;
  return typeof publicKey === "string" ? publicKey : publicKey?.toString();
}

function getNestedSolanaProvider(provider: LegacySolanaProvider | { solana?: LegacySolanaProvider } | undefined): LegacySolanaProvider | undefined {
  if (!provider) return undefined;
  if ("connect" in provider) return provider;
  return provider.solana;
}
