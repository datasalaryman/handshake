import { Address, Connection, Transaction } from "@solana/web3.js";
import { useWalletUi } from "@wallet-ui/react";
import { ArrowUpDown, Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { appClusters, defaultCluster, isDevelopmentEnvironment, type AppCluster } from "@/components/providers/SolanaProvider";
import { TokenPickerModal } from "@/components/groups/TokenPickerModal";
import { WalletSelector } from "@/components/groups/WalletSelector";
import { ActionButton } from "@/components/units/ActionButton";
import { ClusterSelector } from "@/components/units/ClusterSelector";
import { Field } from "@/components/units/Field";
import { InfoRow } from "@/components/units/InfoRow";
import { SolanaExplorerButton } from "@/components/units/SolanaExplorerButton";
import { SwapSideCard } from "@/components/units/SwapSideCard";
import { TokenPickerButton } from "@/components/units/TokenPickerButton";
import { orpc } from "@/lib/orpc";
import { buildHandshakeRevocation, buildSwapAuthorization, encodeVectorAuthorization, getVectorNonce, prepareMakerVectorAccount, signAndSendWalletTransaction, simulateTransaction } from "@/lib/swap-transactions";
import { createDeterministicKeypair, signAdvanceInstruction, vectorIdentity } from "@/lib/vector";
import { getCurrentWalletAddress } from "@/lib/wallet-adapters";
import type { SwapOffer } from "@/orpc/schema";
import type { SwapFormState, TokenSearchResult } from "@/lib/wallet-types";

const solToken: TokenSearchResult = {
  address: import.meta.env.BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_ADDRESS ?? "So11111111111111111111111111111111111111112",
  name: import.meta.env.BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_NAME ?? "Wrapped SOL",
  symbol: import.meta.env.BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_SYMBOL ?? "SOL",
  icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  decimals: Number(import.meta.env.BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_DECIMALS ?? 9),
  isVerified: true,
  organicScoreLabel: "high",
  isSus: false,
};

const usdcToken: TokenSearchResult = {
  address: import.meta.env.BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_ADDRESS ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  name: import.meta.env.BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_NAME ?? "USD Coin",
  symbol: import.meta.env.BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_SYMBOL ?? "USDC",
  icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  decimals: Number(import.meta.env.BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_DECIMALS ?? 6),
  isVerified: true,
  organicScoreLabel: "high",
  isSus: false,
};

const defaultSwapForm: SwapFormState = {
  makerSendTokenAddress: solToken.address,
  makerSendAmount: "",
  takerAddress: "",
  takerSendTokenAddress: usdcToken.address,
  takerSendAmount: "",
};

export function MakerPanel() {
  const { account, connected, disconnect, wallets } = useWalletUi();
  const [clusterId, setClusterId] = useState<AppCluster["id"]>(defaultCluster.id);
  const [connectedWalletName, setConnectedWalletName] = useState<string>();
  const [connectedAddress, setConnectedAddress] = useState<string>();
  const [form, setForm] = useState<SwapFormState>(defaultSwapForm);
  const [makerSendToken, setMakerSendToken] = useState<TokenSearchResult | undefined>(solToken);
  const [takerSendToken, setTakerSendToken] = useState<TokenSearchResult | undefined>(usdcToken);
  const [tokenPickerMode, setTokenPickerMode] = useState<"maker-send" | "taker-send">();
  const [generatedLink, setGeneratedLink] = useState<string>();
  const [generatedOffer, setGeneratedOffer] = useState<SwapOffer>();
  const [makerProofSignature, setMakerProofSignature] = useState<string>();
  const [makerPreparationSignature, setMakerPreparationSignature] = useState<string>();
  const [makerRevocationPreparationSignature, setMakerRevocationPreparationSignature] = useState<string>();
  const [makerRevocationSignature, setMakerRevocationSignature] = useState<string>();
  const [copiedLink, setCopiedLink] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (connected && (connectedAddress || connectedWalletName)) {
    setConnectedAddress(undefined);
    setConnectedWalletName(undefined);
  }
  const address = account?.address ?? connectedAddress;
  const makerAddressValue = address?.toString() ?? "";
  const cluster = appClusters.find((clusterOption) => clusterOption.id === clusterId) ?? defaultCluster;
  const isConnected = connected || Boolean(connectedAddress);

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
    setGeneratedLink(undefined);
    setGeneratedOffer(undefined);
    setMakerProofSignature(undefined);
    setMakerPreparationSignature(undefined);
    setMakerRevocationPreparationSignature(undefined);
    setMakerRevocationSignature(undefined);
    setCopiedLink(false);
    setStatus(undefined);
  }, [makerAddressValue, form.makerSendTokenAddress, form.makerSendAmount, form.takerAddress, form.takerSendTokenAddress, form.takerSendAmount]);

  async function createMakerSignedLink() {
    if (!makerAddressValue) throw new Error("Connect the maker wallet first.");
    setBusy(true);
    setError(undefined);
    setCopiedLink(false);
    setStatus("Building maker-authorized swap...");

    try {
      const makerAddress = new Address(makerAddressValue);
      const takerAddress = new Address(form.takerAddress);
      const connection = new Connection(cluster.url, "confirmed");
      const vectorKeypair = createDeterministicKeypair(makerAddress, { ...form, clusterId: cluster.id });
      const identity = vectorIdentity(vectorKeypair.publicKey);
      const makerSetup = await prepareMakerVectorAccount(connection, makerAddress, vectorKeypair, identity, form, connectedWalletName, cluster, setStatus);
      const { passthroughIx, takerTransferIx } = await buildSwapAuthorization(connection, makerAddress, identity, form);
      const advanceIx = signAdvanceInstruction(vectorKeypair, await getVectorNonce(connection, identity), [], [passthroughIx, takerTransferIx], takerAddress);
      const vectorSignature = encodeVectorAuthorization(identity, advanceIx.data.slice(1));

      const offer = await orpc.swapOffers.create({
        clusterId: cluster.id,
        makerAddress: makerAddress.toString(),
        makerSendTokenAddress: form.makerSendTokenAddress,
        makerSendAmount: form.makerSendAmount,
        takerAddress: takerAddress.toString(),
        takerSendTokenAddress: form.takerSendTokenAddress,
        takerSendAmount: form.takerSendAmount,
        vectorSignature,
        makerProofSignature: makerSetup.makerProofSignature,
        makerPreparationSignature: makerSetup.makerPreparationSignature,
      });

      const link = new URL(`/swap/${offer.id}`, window.location.origin);
      setGeneratedLink(link.toString());
      setGeneratedOffer(offer);
      setMakerProofSignature(makerSetup.makerProofSignature);
      setMakerPreparationSignature(makerSetup.makerPreparationSignature);
      setStatus("Copy the swap link and send it to the other party so they can complete the handshake.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create maker-signed swap link.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeHandshake() {
    if (!generatedOffer) throw new Error("Create a swap link before revoking it.");
    if (!makerAddressValue) throw new Error("Connect the maker wallet first.");
    setBusy(true);
    setError(undefined);
    setStatus("Building revocation transaction...");

    try {
      const makerAddress = new Address(makerAddressValue);
      const connection = new Connection(cluster.url, "confirmed");
      const vectorKeypair = createDeterministicKeypair(makerAddress, generatedOffer);
      const identity = vectorIdentity(vectorKeypair.publicKey);
      const { setupIxs, assetReturnPassthroughIx, closeVectorPassthroughIx } = await buildHandshakeRevocation(connection, makerAddress, identity, generatedOffer);
      let revocationPreparationSignature: string | undefined;

      if (assetReturnPassthroughIx) {
        setStatus("Returning maker escrow assets...");
        const advanceIx = signAdvanceInstruction(vectorKeypair, await getVectorNonce(connection, identity), setupIxs, [assetReturnPassthroughIx], makerAddress);
        const setupTx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(...setupIxs, advanceIx, assetReturnPassthroughIx);
        await simulateTransaction(connection, setupTx);
        revocationPreparationSignature = await signAndSendWalletTransaction(connectedWalletName, setupTx, cluster, connection);
      }

      setStatus("Revoking handshake and closing Vector account...");
      const advanceIx = signAdvanceInstruction(vectorKeypair, await getVectorNonce(connection, identity), [], [closeVectorPassthroughIx], makerAddress);
      const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(advanceIx, closeVectorPassthroughIx);
      await simulateTransaction(connection, tx);
      const revocationSignature = await signAndSendWalletTransaction(connectedWalletName, tx, cluster, connection);
      const updatedOffer = await orpc.swapOffers.markRevoked({
        id: generatedOffer.id,
        makerRevocationPreparationSignature: revocationPreparationSignature,
        makerRevocationSignature: revocationSignature,
      });
      setGeneratedOffer(updatedOffer);
      setMakerRevocationPreparationSignature(revocationPreparationSignature);
      setMakerRevocationSignature(revocationSignature);
      setStatus("Handshake revoked. The taker link now shows this offer as revoked.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not revoke handshake.");
    } finally {
      setBusy(false);
    }
  }

  function swapTokens() {
    setMakerSendToken(takerSendToken);
    setTakerSendToken(makerSendToken);
    setForm((current) => ({
      ...current,
      makerSendTokenAddress: current.takerSendTokenAddress,
      makerSendAmount: current.takerSendAmount,
      takerSendTokenAddress: current.makerSendTokenAddress,
      takerSendAmount: current.makerSendAmount,
    }));
  }

  async function copyGeneratedLink() {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setCopiedLink(true);
  }

  const takerAddressMatchesMaker = Boolean(makerAddressValue && form.takerAddress.trim() === makerAddressValue);
  const takerAddressError = takerAddressMatchesMaker ? "Taker address must be different from the maker address." : undefined;
  const canCreateSwapLink = Boolean(form.takerAddress.trim() && form.makerSendAmount.trim() && form.takerSendAmount.trim() && !takerAddressError);
  const canRevokeHandshake = Boolean(generatedOffer && makerProofSignature && makerPreparationSignature && !generatedOffer.isRevoked);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-violet-950/30 backdrop-blur sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-violet-200/70">Create handshake</p>
          <h2 className="mt-1 text-2xl font-semibold">Start a peer-to-peer swap</h2>
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

      <form className="mt-5 grid gap-4" onSubmit={(event) => event.preventDefault()}>
        <Field label="Handshake with" value={form.takerAddress} onChange={(takerAddress) => setForm((current) => ({ ...current, takerAddress }))} error={takerAddressError} />
        <SwapSideCard title="Send">
          <TokenPickerButton token={makerSendToken} tokenAddress={form.makerSendTokenAddress} placeholder="Token" onClick={() => setTokenPickerMode("maker-send")} />
          <Field label="Amount to send" hideLabel value={form.makerSendAmount} onChange={(makerSendAmount) => setForm((current) => ({ ...current, makerSendAmount }))} inputMode="decimal" placeholder="0.00" />
        </SwapSideCard>
        <div className="relative flex justify-center py-1">
          <button className="rounded-full border border-white/10 bg-violet-400/15 p-3 text-violet-100 shadow-lg shadow-violet-950/30 transition hover:border-violet-200/40 hover:bg-violet-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200" type="button" aria-label="Reverse tokens" onClick={swapTokens}>
            <ArrowUpDown className="size-5" aria-hidden="true" />
          </button>
        </div>
        <SwapSideCard title="Receive">
          <TokenPickerButton token={takerSendToken} tokenAddress={form.takerSendTokenAddress} placeholder="Token" onClick={() => setTokenPickerMode("taker-send")} />
          <Field label="Amount to receive" hideLabel value={form.takerSendAmount} onChange={(takerSendAmount) => setForm((current) => ({ ...current, takerSendAmount }))} inputMode="decimal" placeholder="0.00" />
        </SwapSideCard>
      </form>

      {tokenPickerMode ? <TokenPickerModal selectedToken={tokenPickerMode === "maker-send" ? makerSendToken : takerSendToken} title={tokenPickerMode === "maker-send" ? "Select token to send" : "Select token to receive"} onClose={() => setTokenPickerMode(undefined)} onSelect={(token) => {
        if (tokenPickerMode === "maker-send") {
          setMakerSendToken(token);
          setForm((current) => ({ ...current, makerSendTokenAddress: token.address }));
        } else {
          setTakerSendToken(token);
          setForm((current) => ({ ...current, takerSendTokenAddress: token.address }));
        }
        setTokenPickerMode(undefined);
      }} /> : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <ActionButton disabled={busy || !isConnected || Boolean(generatedLink) || !canCreateSwapLink} onClick={() => void createMakerSignedLink()}>Create swap link</ActionButton>
        {makerProofSignature ? <SolanaExplorerButton signature={makerProofSignature} cluster={cluster} label="Vector Init" /> : null}
        {makerPreparationSignature ? <SolanaExplorerButton signature={makerPreparationSignature} cluster={cluster} label="Prep" /> : null}
        {generatedLink ? <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-semibold text-white transition hover:border-violet-200/40 hover:bg-white/10" type="button" onClick={() => void copyGeneratedLink()}>
          {copiedLink ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copiedLink ? "Copied" : "Copy Swap Link"}
        </button> : null}
        {generatedOffer ? <ActionButton disabled={busy || !isConnected || !canRevokeHandshake} onClick={() => void revokeHandshake()}>Revoke Handshake</ActionButton> : null}
        {makerRevocationPreparationSignature ? <SolanaExplorerButton signature={makerRevocationPreparationSignature} cluster={cluster} label="Revoke Prep" /> : null}
        {makerRevocationSignature ? <SolanaExplorerButton signature={makerRevocationSignature} cluster={cluster} label="Revoke" /> : null}
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
