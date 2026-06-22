import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Address, Connection, Transaction } from "@solana/web3.js";
import { useWalletUi } from "@wallet-ui/react";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { appClusters, defaultCluster, isDevelopmentEnvironment, type AppCluster } from "@/components/providers/SolanaProvider";
import { WalletSelector } from "@/components/groups/WalletSelector";
import { ActionButton } from "@/components/units/ActionButton";
import { ClusterSelector } from "@/components/units/ClusterSelector";
import { SolanaExplorerButton } from "@/components/units/SolanaExplorerButton";
import { SwapSideCard } from "@/components/units/SwapSideCard";
import { TokenIcon } from "@/components/units/TokenIcon";
import { orpc } from "@/lib/orpc";
import { buildSwapAuthorization, decodeVectorAuthorization, signAndSendWalletTransaction, simulateTransaction } from "@/lib/swap-transactions";
import { createAdvanceInstruction } from "@/lib/vector";
import { getCurrentWalletAddress } from "@/lib/wallet-adapters";
import type { SwapOffer } from "@/orpc/schema";
import type { TokenSearchResult } from "@/lib/wallet-types";

export function TakerPanel({ swapId }: { swapId: string }) {
  const queryClient = useQueryClient();
  const { account, connected, disconnect, wallets } = useWalletUi();
  const [selectedClusterId, setSelectedClusterId] = useState<AppCluster["id"]>();
  const [connectedWalletName, setConnectedWalletName] = useState<string>();
  const [connectedAddress, setConnectedAddress] = useState<string>();
  const [copiedTokenAddress, setCopiedTokenAddress] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const swapOfferQuery = useQuery({
    queryKey: ["swapOffers", swapId],
    queryFn: () => orpc.swapOffers.get({ id: swapId }),
  });
  const loadedOffer = swapOfferQuery.data;
  const tokenMetadataQuery = useQuery({
    queryKey: ["swapOffers", swapId, "tokenMetadata", loadedOffer?.makerSendTokenAddress, loadedOffer?.takerSendTokenAddress],
    queryFn: async () => {
      if (!loadedOffer) return undefined;
      const [makerSendResults, takerSendResults] = await Promise.all([
        orpc.tokens.search({ query: loadedOffer.makerSendTokenAddress }),
        orpc.tokens.search({ query: loadedOffer.takerSendTokenAddress }),
      ]);

      return {
        makerSendToken: findTokenByAddress(makerSendResults as TokenSearchResult[], loadedOffer.makerSendTokenAddress),
        takerSendToken: findTokenByAddress(takerSendResults as TokenSearchResult[], loadedOffer.takerSendTokenAddress),
      };
    },
    enabled: Boolean(loadedOffer),
  });
  const offerClusterId = loadedOffer?.clusterId as AppCluster["id"] | undefined;
  const clusterId = selectedClusterId ?? (appClusters.some((clusterOption) => clusterOption.id === offerClusterId) ? offerClusterId : defaultCluster.id);
  if (connected && (connectedAddress || connectedWalletName)) {
    setConnectedAddress(undefined);
    setConnectedWalletName(undefined);
  }
  const address = account?.address ?? connectedAddress;
  const takerAddressValue = address?.toString() ?? "";
  const cluster = appClusters.find((clusterOption) => clusterOption.id === clusterId) ?? defaultCluster;
  const isConnected = connected || Boolean(connectedAddress);
  const connectedWalletMatchesTaker = Boolean(!loadedOffer || !takerAddressValue || takerAddressValue === loadedOffer.takerAddress);
  const submittedSignature = loadedOffer?.submittedSignature;
  const loadError = swapOfferQuery.error instanceof Error ? swapOfferQuery.error.message : swapOfferQuery.error ? "Could not load swap offer." : undefined;
  const displayStatus = status ?? (swapOfferQuery.isLoading ? "Loading maker-signed swap offer..." : loadedOffer ? "Loaded maker-signed swap offer." : undefined);
  const displayError = error ?? loadError;

  useEffect(() => {
    if (!connectedWalletName) return;
    const walletName = connectedWalletName;

    async function syncWalletAddress() {
      const nextAddress = await getCurrentWalletAddress(walletName);
      if (nextAddress) setConnectedAddress(nextAddress);
    }

    void syncWalletAddress();
    window.addEventListener("focus", syncWalletAddress);
    const interval = window.setInterval(syncWalletAddress, 1000);

    return () => {
      window.removeEventListener("focus", syncWalletAddress);
      window.clearInterval(interval);
    };
  }, [connectedWalletName]);

  async function executeLoadedSwap() {
    if (!loadedOffer) throw new Error("Open a maker-generated swap link first.");
    if (!takerAddressValue) throw new Error("Connect the taker wallet first.");
    if (takerAddressValue !== loadedOffer.takerAddress) throw new Error("Connected wallet must match the taker address on the offer.");
    setBusy(true);
    setError(undefined);
    setStatus("Preparing taker submission transaction...");

    try {
      const connection = new Connection(cluster.url, "confirmed");
      const makerAddress = new Address(loadedOffer.makerAddress);
      const takerAddress = new Address(loadedOffer.takerAddress);
      const { identity, signature: vectorSignature } = decodeVectorAuthorization(loadedOffer.vectorSignature);
      const { setupIxs, passthroughIx, takerTransferIx } = await buildSwapAuthorization(connection, makerAddress, identity, loadedOffer);
      const advanceIx = createAdvanceInstruction(identity, vectorSignature);
      const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: takerAddress }).add(...setupIxs, advanceIx, passthroughIx, takerTransferIx);

      await simulateTransaction(connection, tx);
      const submittedSignature = await signAndSendWalletTransaction(connectedWalletName, tx, cluster, connection);
      const updatedOffer = await orpc.swapOffers.markSubmitted({ id: loadedOffer.id, submittedSignature });
      queryClient.setQueryData(["swapOffers", swapId], updatedOffer);
      setStatus(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not execute swap.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-violet-950/30 backdrop-blur sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-violet-200/70">Accept handshake</p>
          <h2 className="mt-1 text-2xl font-semibold">Complete a peer-to-peer swap</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDevelopmentEnvironment ? <ClusterSelector cluster={cluster} onClusterChange={setSelectedClusterId} /> : null}
          {!isConnected ? <WalletSelector wallets={wallets} onConnect={(walletName, address) => {
            setConnectedWalletName(walletName);
            setConnectedAddress(address);
          }} onError={setError} /> : null}
          {isConnected ? <DisconnectButton onDisconnect={() => {
            disconnect();
            setConnectedAddress(undefined);
            setConnectedWalletName(undefined);
          }} /> : null}
        </div>
      </div>

      {!connectedWalletMatchesTaker ? <p className="mt-5 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">Connected wallet does not match the intended taker for this handshake.</p> : <TakerSwapSummary offer={loadedOffer} makerSendToken={tokenMetadataQuery.data?.makerSendToken} takerSendToken={tokenMetadataQuery.data?.takerSendToken} isLoadingTokens={tokenMetadataQuery.isFetching} tokenError={tokenMetadataQuery.error} copiedTokenAddress={copiedTokenAddress} onCopyTokenAddress={(tokenAddress) => {
        void navigator.clipboard.writeText(tokenAddress);
        setCopiedTokenAddress(tokenAddress);
      }} />}

      {connectedWalletMatchesTaker ? <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <ActionButton disabled={busy || !isConnected || swapOfferQuery.isLoading || !loadedOffer || loadedOffer.status === "submitted"} onClick={() => void executeLoadedSwap()}>Take swap</ActionButton>
        {loadedOffer?.makerProofSignature ? <SolanaExplorerButton signature={loadedOffer.makerProofSignature} cluster={cluster} label="Proof" /> : null}
        {submittedSignature ? <SolanaExplorerButton signature={submittedSignature} cluster={cluster} /> : null}
      </div> : null}

      {displayStatus ? <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">{displayStatus}</p> : null}
      {displayError ? <p className="mt-4 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{displayError}</p> : null}
    </div>
  );
}

function TakerSwapSummary({ offer, makerSendToken, takerSendToken, isLoadingTokens, tokenError, copiedTokenAddress, onCopyTokenAddress }: { offer: SwapOffer | undefined; makerSendToken: TokenSearchResult | undefined; takerSendToken: TokenSearchResult | undefined; isLoadingTokens: boolean; tokenError: unknown; copiedTokenAddress: string | undefined; onCopyTokenAddress: (tokenAddress: string) => void }) {
  if (!offer) {
    return <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Loading handshake...</p>;
  }

  const error = tokenError instanceof Error ? tokenError.message : tokenError ? "Could not load token metadata." : undefined;

  return (
    <div className="mt-5 grid gap-4">
      {isLoadingTokens ? <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Loading Jupiter token metadata...</p> : null}
      {error ? <p className="rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{error}</p> : null}
      <SwapSideCard title={`Maker ${abbreviateAddress(offer.makerAddress)} wants to send you`}>
        <TokenSummary token={makerSendToken} tokenAddress={offer.makerSendTokenAddress} copied={copiedTokenAddress === offer.makerSendTokenAddress} onCopy={onCopyTokenAddress} />
        <AmountSummary amount={offer.makerSendAmount} />
      </SwapSideCard>
      <SwapSideCard title="Maker will receive">
        <TokenSummary token={takerSendToken} tokenAddress={offer.takerSendTokenAddress} copied={copiedTokenAddress === offer.takerSendTokenAddress} onCopy={onCopyTokenAddress} />
        <AmountSummary amount={offer.takerSendAmount} />
      </SwapSideCard>
    </div>
  );
}

function TokenSummary({ token, tokenAddress, copied, onCopy }: { token: TokenSearchResult | undefined; tokenAddress: string; copied: boolean; onCopy: (tokenAddress: string) => void }) {
  const displayToken = token ?? fallbackToken(tokenAddress);

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <TokenIcon token={displayToken} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-semibold text-white">{displayToken.symbol}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${token?.isVerified ? "bg-emerald-300/15 text-emerald-100" : "bg-amber-300/15 text-amber-100"}`}>{token?.isVerified ? "Verified" : "Unverified"}</span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-400">{displayToken.name}</p>
        </div>
        <button className="rounded-lg border border-white/10 p-2 text-slate-300 transition hover:border-violet-200/40 hover:bg-white/10 hover:text-white" type="button" aria-label="Copy token address" onClick={() => onCopy(tokenAddress)}>
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function AmountSummary({ amount }: { amount: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Amount</p>
      <p className="mt-2 text-base font-semibold text-white">{amount}</p>
    </div>
  );
}

function findTokenByAddress(tokens: TokenSearchResult[], address: string) {
  return tokens.find((token) => token.address === address) ?? tokens[0];
}

function fallbackToken(address: string): TokenSearchResult {
  return {
    address,
    name: "Unknown token",
    symbol: abbreviateAddress(address),
    decimals: 0,
    isVerified: false,
    isSus: false,
  };
}

function abbreviateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function DisconnectButton({ onDisconnect }: { onDisconnect: () => void }) {
  return (
    <button className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-100" type="button" onClick={onDisconnect}>
      Disconnect
    </button>
  );
}
