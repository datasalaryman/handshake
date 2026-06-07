import { Address, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { WalletUiIcon, useWalletUi, type UiWallet } from "@wallet-ui/react";
import { useEffect, useState } from "react";
import { appClusters, defaultCluster, type AppCluster } from "./clusters";
import { SolanaProvider } from "./SolanaProvider";

type BalanceState = {
  error?: string;
  loading: boolean;
  sol?: string;
};

export function WalletPanel() {
  return (
    <SolanaProvider>
      <WalletAccountCard />
    </SolanaProvider>
  );
}

function WalletAccountCard() {
  const { account, connected, disconnect, wallets } = useWalletUi();
  const [clusterId, setClusterId] = useState(defaultCluster.id);
  const [connectedWalletName, setConnectedWalletName] = useState<string>();
  const [connectedAddress, setConnectedAddress] = useState<string>();
  const [balance, setBalance] = useState<BalanceState>({ loading: false });
  const address = account?.address ?? connectedAddress;
  const cluster = appClusters.find((clusterOption) => clusterOption.id === clusterId) ?? defaultCluster;

  useEffect(() => {
    if (!address) {
      setBalance({ loading: false });
      return;
    }

    const abortController = new AbortController();
    const balanceAddress = new Address(address);
    setBalance({ loading: true });

    async function loadBalance() {
      try {
        const connection = new Connection(cluster.url, "confirmed");
        const lamports = await connection.getBalance(balanceAddress);

        if (!abortController.signal.aborted) {
          setBalance({ loading: false, sol: formatSol(lamports) });
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setBalance({
            loading: false,
            error: getBalanceErrorMessage(error, cluster.label, cluster.url),
          });
        }
      }
    }

    void loadBalance();

    return () => abortController.abort();
  }, [address, cluster.url]);

  useEffect(() => {
    if (connected) {
      setConnectedAddress(undefined);
      setConnectedWalletName(undefined);
    }
  }, [connected]);

  useEffect(() => {
    if (!connectedWalletName) return;
    const walletName = connectedWalletName;

    async function syncWalletAddress() {
      const nextAddress = await getCurrentWalletAddress(walletName);

      if (nextAddress) {
        setConnectedAddress(nextAddress);
      }
    }

    void syncWalletAddress();
    window.addEventListener("focus", syncWalletAddress);
    const interval = window.setInterval(syncWalletAddress, 1000);

    return () => {
      window.removeEventListener("focus", syncWalletAddress);
      window.clearInterval(interval);
    };
  }, [connectedWalletName]);

  const isConnected = connected || Boolean(connectedAddress);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-violet-950/30 backdrop-blur sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-violet-200/70">Wallet</p>
          <h2 className="mt-1 text-2xl font-semibold">Account status</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <ClusterSelector cluster={cluster} onClusterChange={setClusterId} />
          {isConnected ? (
            <button
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-100"
              type="button"
              onClick={() => {
                disconnect();
                setConnectedAddress(undefined);
                setConnectedWalletName(undefined);
              }}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>

      {!isConnected ? <WalletConnector wallets={wallets} onConnect={(walletName, address) => {
        setConnectedWalletName(walletName);
        setConnectedAddress(address);
      }} /> : null}

      <div className="grid gap-3">
        <InfoRow label="Network" value={cluster.label} />
        <InfoRow label="Public key" value={address ?? "Not connected"} mono />
        <InfoRow label="SOL balance" value={getBalanceText(balance, isConnected)} emphasize />
      </div>
    </div>
  );
}

function ClusterSelector({ cluster, onClusterChange }: { cluster: AppCluster; onClusterChange: (clusterId: AppCluster["id"]) => void }) {
  return (
    <>
      <label className="sr-only" htmlFor="cluster-select">
        Cluster
      </label>
      <select
        className="rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-100"
        id="cluster-select"
        value={cluster.id}
        onChange={(event) => onClusterChange(event.target.value as AppCluster["id"])}
      >
        {appClusters.map((clusterOption) => (
          <option key={clusterOption.id} value={clusterOption.id}>
            {clusterOption.label}
          </option>
        ))}
      </select>
    </>
  );
}

function WalletConnector({ wallets, onConnect }: { wallets: UiWallet[]; onConnect: (walletName: string, address: string) => void }) {
  if (!wallets.length) {
    return (
      <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
        No Solana wallet extensions were detected. Install a Wallet Standard compatible extension or enable it for this site.
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="mb-3 text-sm font-medium text-slate-200">Select wallet</p>
      <div className="grid gap-2">
        {wallets.map((wallet) =>
          wallet.features.includes("standard:connect") ? (
            <StandardWalletButton key={wallet.name} wallet={wallet} onConnect={onConnect} />
          ) : (
            <LegacyWalletButton key={wallet.name} wallet={wallet} onConnect={onConnect} />
          ),
        )}
      </div>
    </div>
  );
}

function StandardWalletButton({ wallet, onConnect }: { wallet: UiWallet; onConnect: (walletName: string, address: string) => void }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <button
      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
      disabled={isConnecting}
      type="button"
      onClick={async () => {
        setError(undefined);
        setIsConnecting(true);
        try {
          const standardWallet = getWallets()
            .get()
            .find((registeredWallet) => registeredWallet.name === wallet.name);
          const connectFeature = standardWallet?.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined;

          if (!standardWallet || !connectFeature) {
            throw new Error("Wallet extension was detected, but its connect feature is unavailable. Refresh the page and try again.");
          }

          const result = await connectFeature.connect();
          const account = result.accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? result.accounts[0];

          if (!account?.address) {
            throw new Error("The wallet did not return a Solana account.");
          }

          onConnect(wallet.name, account.address);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not connect wallet.");
        } finally {
          setIsConnecting(false);
        }
      }}
    >
      <WalletName wallet={wallet} detail={error ?? "Wallet Standard"} />
      <span className="text-sm text-violet-200">{isConnecting ? "Connecting..." : "Connect"}</span>
    </button>
  );
}

function LegacyWalletButton({ wallet, onConnect }: { wallet: UiWallet; onConnect: (walletName: string, address: string) => void }) {
  const [error, setError] = useState<string>();
  const provider = getLegacySolanaProvider(wallet.name);

  return (
    <button
      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!provider}
      type="button"
      onClick={async () => {
        if (!provider) return;
        setError(undefined);
        try {
          const result = await provider.connect();
          const publicKey = result?.publicKey ?? provider.publicKey;
          const address = typeof publicKey === "string" ? publicKey : publicKey?.toString();

          if (!address) {
            throw new Error("The wallet did not return a public key.");
          }

          onConnect(wallet.name, address);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not connect wallet.");
        }
      }}
    >
      <WalletName wallet={wallet} detail={error ?? (provider ? "Extension fallback" : wallet.features.join(", ") || "Unavailable")} />
      <span className="text-sm text-violet-200">{provider ? "Connect" : "Unavailable"}</span>
    </button>
  );
}

function WalletName({ wallet, detail }: { wallet: UiWallet; detail: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <WalletUiIcon className="h-7 w-7 rounded-full" wallet={wallet} />
      <span className="min-w-0">
        <span className="block font-medium text-slate-100">{wallet.name}</span>
        <span className="block truncate text-xs text-slate-400">{detail}</span>
      </span>
    </span>
  );
}

function InfoRow({ label, value, mono, emphasize }: { label: string; value: string; mono?: boolean; emphasize?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className={`mt-2 break-all ${mono ? "font-mono text-sm" : "text-base"} ${emphasize ? "text-3xl font-semibold text-emerald-300" : "text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}

function getBalanceText(balance: BalanceState, connected: boolean) {
  if (!connected) return "Connect wallet";
  if (balance.loading) return "Loading...";
  if (balance.error) return balance.error;
  return `${balance.sol ?? "0"} SOL`;
}

function getBalanceErrorMessage(error: unknown, clusterLabel: string, rpcUrl: string) {
  const message = error instanceof Error ? error.message : "Unable to load balance.";

  if (message.includes("403")) {
    return `${clusterLabel} RPC blocked this browser request (${rpcUrl}). Use another RPC URL or switch networks.`;
  }

  return message;
}

function formatSol(lamports: bigint) {
  const whole = lamports / BigInt(LAMPORTS_PER_SOL);
  const fractional = lamports % BigInt(LAMPORTS_PER_SOL);
  const decimals = fractional.toString().padStart(9, "0").replace(/0+$/, "");

  return decimals ? `${whole}.${decimals}` : whole.toString();
}

type LegacySolanaProvider = {
  connect: () => Promise<{ publicKey?: string | { toString(): string } }>;
  disconnect?: () => Promise<void>;
  publicKey?: string | { toString(): string };
};

function getLegacySolanaProvider(walletName: string): LegacySolanaProvider | undefined {
  const win = window as typeof window & {
    backpack?: LegacySolanaProvider | { solana?: LegacySolanaProvider };
    jupiter?: LegacySolanaProvider | { solana?: LegacySolanaProvider };
    solana?: LegacySolanaProvider;
  };
  const normalized = walletName.toLowerCase();

  if (normalized.includes("backpack")) {
    return getNestedSolanaProvider(win.backpack);
  }

  if (normalized.includes("jupiter")) {
    return getNestedSolanaProvider(win.jupiter);
  }

  if (normalized.includes("phantom")) {
    return win.solana;
  }
}

function getNestedSolanaProvider(
  provider: LegacySolanaProvider | { solana?: LegacySolanaProvider } | undefined,
): LegacySolanaProvider | undefined {
  if (!provider) return undefined;
  if ("connect" in provider) return provider;
  return provider.solana;
}

async function getCurrentWalletAddress(walletName: string) {
  const standardWallet = getWallets()
    .get()
    .find((registeredWallet) => registeredWallet.name === walletName);
  const standardAccount = standardWallet?.accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? standardWallet?.accounts[0];

  if (standardAccount?.address) {
    return standardAccount.address;
  }

  const connectFeature = standardWallet?.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined;

  try {
    const result = await connectFeature?.connect({ silent: true });
    const account = result?.accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? result?.accounts[0];

    if (account?.address) {
      return account.address;
    }
  } catch {
    // Some wallets do not support silent reconnect; fall through to extension state.
  }

  const provider = getLegacySolanaProvider(walletName);
  const publicKey = provider?.publicKey;

  return typeof publicKey === "string" ? publicKey : publicKey?.toString();
}
