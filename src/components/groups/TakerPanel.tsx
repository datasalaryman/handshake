import { Address, Connection, Transaction } from "@solana/web3.js";
import { useWalletUi } from "@wallet-ui/react";
import { useEffect, useState } from "react";
import { appClusters, defaultCluster, isDevelopmentEnvironment, type AppCluster } from "@/components/providers/SolanaProvider";
import { SwapDetails } from "@/components/groups/SwapDetails";
import { WalletSelector } from "@/components/groups/WalletSelector";
import { ActionButton } from "@/components/units/ActionButton";
import { ClusterSelector } from "@/components/units/ClusterSelector";
import { InfoRow } from "@/components/units/InfoRow";
import { orpc } from "@/lib/orpc";
import { buildSwapAuthorization, decodeVectorAuthorization, signAndSendWalletTransaction, simulateTransaction } from "@/lib/swap-transactions";
import { createAdvanceInstruction } from "@/lib/vector";
import { getCurrentWalletAddress } from "@/lib/wallet-adapters";
import type { SwapOffer } from "@/orpc/schema";

export function TakerPanel({ swapId }: { swapId: string }) {
  const { account, connected, disconnect, wallets } = useWalletUi();
  const [clusterId, setClusterId] = useState<AppCluster["id"]>(defaultCluster.id);
  const [connectedWalletName, setConnectedWalletName] = useState<string>();
  const [connectedAddress, setConnectedAddress] = useState<string>();
  const [loadedOffer, setLoadedOffer] = useState<SwapOffer>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const address = account?.address ?? connectedAddress;
  const cluster = appClusters.find((clusterOption) => clusterOption.id === clusterId) ?? defaultCluster;
  const isConnected = connected || Boolean(connectedAddress);

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

  useEffect(() => {
    async function loadSwap() {
      try {
        const offer = await orpc.swapOffers.get({ id: swapId });
        setLoadedOffer(offer);
        const offerClusterId = offer.clusterId as AppCluster["id"];
        setClusterId(appClusters.some((clusterOption) => clusterOption.id === offerClusterId) ? offerClusterId : defaultCluster.id);
        setStatus("Loaded maker-signed swap offer.");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not load swap offer.");
      }
    }

    void loadSwap();
  }, [swapId]);

  async function executeLoadedSwap() {
    if (!loadedOffer) throw new Error("Open a maker-generated swap link first.");
    if (!address) throw new Error("Connect the taker wallet first.");
    if (address !== loadedOffer.takerAddress) throw new Error("Connected wallet must match the taker address on the offer.");
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
      setLoadedOffer(updatedOffer);
      setStatus(`Swap submitted: ${submittedSignature}`);
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
          <p className="text-sm uppercase tracking-[0.24em] text-violet-200/70">Peer swap</p>
          <h2 className="mt-1 text-2xl font-semibold">Take Vector-signed swap</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDevelopmentEnvironment ? <ClusterSelector cluster={cluster} onClusterChange={setClusterId} /> : null}
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

      <div className="grid gap-3">
        <InfoRow label="Connected taker address" value={address ?? "Not connected"} mono />
      </div>

      <SwapDetails offer={loadedOffer} />

      <div className="mt-5 grid gap-3">
        <ActionButton disabled={busy || !isConnected || !loadedOffer || loadedOffer.status === "submitted"} onClick={() => void executeLoadedSwap()}>Take swap</ActionButton>
      </div>

      {status ? <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">{status}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{error}</p> : null}
    </div>
  );
}

function DisconnectButton({ onDisconnect }: { onDisconnect: () => void }) {
  return (
    <button className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-100" type="button" onClick={onDisconnect}>
      Disconnect
    </button>
  );
}
