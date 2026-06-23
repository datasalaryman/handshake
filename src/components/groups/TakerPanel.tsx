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
import { buildHandshakeRevocation, buildSwapAuthorization, buildSwapPreparationInstructions, decodeVectorAuthorization, getVectorNonce, signAndSendWalletTransaction, simulateTransaction } from "@/lib/swap-transactions";
import { createAdvanceInstruction, createDeterministicKeypair, signAdvanceInstruction, vectorIdentity } from "@/lib/vector";
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
  if (connected && (connectedAddress || connectedWalletName)) {
    setConnectedAddress(undefined);
    setConnectedWalletName(undefined);
  }
  const address = account?.address ?? connectedAddress;
  const connectedAddressValue = address?.toString() ?? "";
  const swapOfferQuery = useQuery({
    queryKey: ["swapOffers", swapId, connectedAddressValue],
    queryFn: () => orpc.swapOffers.get({ id: swapId, connectedAddress: connectedAddressValue }),
    enabled: Boolean(connectedAddressValue),
    refetchInterval: (query) => query.state.data?.isRevoked || query.state.data?.status === "submitted" ? false : 5_000,
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
  const cluster = appClusters.find((clusterOption) => clusterOption.id === clusterId) ?? defaultCluster;
  const isConnected = connected || Boolean(connectedAddress);
  const connectedWalletMatchesMaker = Boolean(loadedOffer && connectedAddressValue === loadedOffer.makerAddress);
  const connectedWalletMatchesTaker = Boolean(loadedOffer && connectedAddressValue === loadedOffer.takerAddress);
  const connectedWalletCanViewOffer = connectedWalletMatchesMaker || connectedWalletMatchesTaker;
  const takerPreparationSignature = loadedOffer?.takerPreparationSignature;
  const submittedSignature = loadedOffer?.submittedSignature;
  const makerRevocationPreparationSignature = loadedOffer?.makerRevocationPreparationSignature;
  const makerRevocationSignature = loadedOffer?.makerRevocationSignature;
  const loadError = swapOfferQuery.error ? "Connected wallet does not match the maker or intended taker for this handshake." : undefined;
  const walletAccessError = !isConnected ? "Wallet not connected." : loadError;
  const displayStatus = status ?? (swapOfferQuery.isLoading ? "Loading maker-signed swap offer..." : loadedOffer ? "Loaded maker-signed swap offer." : undefined);
  const displayError = error;

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
    if (!connectedAddressValue) throw new Error("Connect the taker wallet first.");
    if (connectedAddressValue !== loadedOffer.takerAddress) throw new Error("Connected wallet must match the taker address on the offer.");
    setBusy(true);
    setError(undefined);
    setStatus("Preparing taker submission transaction...");

    try {
      const connection = new Connection(cluster.url, "confirmed");
      const makerAddress = new Address(loadedOffer.makerAddress);
      const takerAddress = new Address(loadedOffer.takerAddress);
      const { identity, signature: vectorSignature } = decodeVectorAuthorization(loadedOffer.vectorSignature);
      const setupIxs = await buildSwapPreparationInstructions(connection, makerAddress, identity, loadedOffer);
      let takerPreparationSignature: string | undefined;
      if (setupIxs.length > 0) {
        setStatus("Preparing token accounts for settlement...");
        const setupTx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: takerAddress }).add(...setupIxs);
        await simulateTransaction(connection, setupTx);
        takerPreparationSignature = await signAndSendWalletTransaction(connectedWalletName, setupTx, cluster, connection);
      }

      setStatus("Submitting Vector settlement transaction...");
      const { passthroughIx, takerTransferIx } = await buildSwapAuthorization(connection, makerAddress, identity, loadedOffer);
      const advanceIx = createAdvanceInstruction(identity, vectorSignature);
      const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: takerAddress }).add(advanceIx, passthroughIx, takerTransferIx);

      await simulateTransaction(connection, tx);
      const submittedSignature = await signAndSendWalletTransaction(connectedWalletName, tx, cluster, connection);
      const updatedOffer = await orpc.swapOffers.markSubmitted({ id: loadedOffer.id, takerPreparationSignature, submittedSignature });
      queryClient.setQueryData(["swapOffers", swapId, connectedAddressValue], updatedOffer);
      setStatus(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not execute swap.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeLoadedHandshake() {
    if (!loadedOffer) throw new Error("Open a maker-generated swap link first.");
    if (!connectedAddressValue) throw new Error("Connect the maker wallet first.");
    if (connectedAddressValue !== loadedOffer.makerAddress) throw new Error("Connected wallet must match the maker address on the offer.");
    setBusy(true);
    setError(undefined);
    setStatus("Building revocation transaction...");

    try {
      const makerAddress = new Address(connectedAddressValue);
      const connection = new Connection(cluster.url, "confirmed");
      const vectorKeypair = createDeterministicKeypair(makerAddress, loadedOffer);
      const identity = vectorIdentity(vectorKeypair.publicKey);
      const { setupIxs, passthroughIx } = await buildHandshakeRevocation(connection, makerAddress, identity, loadedOffer);
      let revocationPreparationSignature: string | undefined;

      if (setupIxs.length > 0) {
        setStatus("Preparing maker refund token account...");
        const setupTx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(...setupIxs);
        await simulateTransaction(connection, setupTx);
        revocationPreparationSignature = await signAndSendWalletTransaction(connectedWalletName, setupTx, cluster, connection);
      }

      setStatus("Revoking handshake and closing escrow accounts...");
      const advanceIx = signAdvanceInstruction(vectorKeypair, await getVectorNonce(connection, identity), [], [passthroughIx], makerAddress);
      const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(advanceIx, passthroughIx);
      await simulateTransaction(connection, tx);
      const revocationSignature = await signAndSendWalletTransaction(connectedWalletName, tx, cluster, connection);
      const updatedOffer = await orpc.swapOffers.markRevoked({
        id: loadedOffer.id,
        makerRevocationPreparationSignature: revocationPreparationSignature,
        makerRevocationSignature: revocationSignature,
      });
      queryClient.setQueryData(["swapOffers", swapId, connectedAddressValue], updatedOffer);
      setStatus("Handshake revoked. The taker link now shows this offer as revoked.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not revoke handshake.");
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

      {walletAccessError ? <p className="mt-5 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{walletAccessError}</p> : null}

      {connectedWalletCanViewOffer && loadedOffer?.isRevoked ? <RevokedHandshakeNotice offer={loadedOffer} /> : null}

      {connectedWalletCanViewOffer && !loadedOffer?.isRevoked ? <TakerSwapSummary offer={loadedOffer} makerSendToken={tokenMetadataQuery.data?.makerSendToken} takerSendToken={tokenMetadataQuery.data?.takerSendToken} isLoadingTokens={tokenMetadataQuery.isFetching} tokenError={tokenMetadataQuery.error} copiedTokenAddress={copiedTokenAddress} onCopyTokenAddress={(tokenAddress) => {
        void navigator.clipboard.writeText(tokenAddress);
        setCopiedTokenAddress(tokenAddress);
      }} /> : null}

      {connectedWalletCanViewOffer ? <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        {connectedWalletMatchesTaker && !loadedOffer?.isRevoked ? <ActionButton disabled={busy || !isConnected || swapOfferQuery.isLoading || !loadedOffer || loadedOffer.status === "submitted"} onClick={() => void executeLoadedSwap()}>Take swap</ActionButton> : null}
        {connectedWalletMatchesMaker && !loadedOffer?.isRevoked ? <ActionButton disabled={busy || !isConnected || swapOfferQuery.isLoading || !loadedOffer || loadedOffer.status === "submitted"} onClick={() => void revokeLoadedHandshake()}>Revoke Handshake</ActionButton> : null}
        {loadedOffer?.makerProofSignature ? <SolanaExplorerButton signature={loadedOffer.makerProofSignature} cluster={cluster} label="Maker Init" /> : null}
        {loadedOffer?.makerPreparationSignature ? <SolanaExplorerButton signature={loadedOffer.makerPreparationSignature} cluster={cluster} label="Maker Prep" /> : null}
        {takerPreparationSignature ? <SolanaExplorerButton signature={takerPreparationSignature} cluster={cluster} label="Taker Prep" /> : null}
        {submittedSignature ? <SolanaExplorerButton signature={submittedSignature} cluster={cluster} label="Vector Action" /> : null}
        {makerRevocationPreparationSignature ? <SolanaExplorerButton signature={makerRevocationPreparationSignature} cluster={cluster} label="Revoke Prep" /> : null}
        {makerRevocationSignature ? <SolanaExplorerButton signature={makerRevocationSignature} cluster={cluster} label="Revoked" /> : null}
      </div> : null}

      {displayStatus ? <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">{displayStatus}</p> : null}
      {displayError ? <p className="mt-4 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{displayError}</p> : null}
    </div>
  );
}

function RevokedHandshakeNotice({ offer }: { offer: SwapOffer }) {
  return (
    <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-50">
      <p className="font-semibold">This handshake has been revoked.</p>
      <p className="mt-2 text-amber-100/80">Maker {abbreviateAddress(offer.makerAddress)} closed the Vector escrow and this swap can no longer be taken.</p>
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
