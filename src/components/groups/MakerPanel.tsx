import { Address, Connection } from "@solana/web3.js";
import { useWalletUi } from "@wallet-ui/react";
import { useEffect, useState } from "react";
import { appClusters, defaultCluster, isDevelopmentEnvironment, type AppCluster } from "@/components/providers/SolanaProvider";
import { TokenPickerModal } from "@/components/groups/TokenPickerModal";
import { WalletSelector } from "@/components/groups/WalletSelector";
import { ActionButton } from "@/components/units/ActionButton";
import { ClusterSelector } from "@/components/units/ClusterSelector";
import { Field } from "@/components/units/Field";
import { InfoRow } from "@/components/units/InfoRow";
import { SwapSideCard } from "@/components/units/SwapSideCard";
import { TokenPickerButton } from "@/components/units/TokenPickerButton";
import { orpc } from "@/lib/orpc";
import { buildSwapAuthorization, encodeVectorAuthorization, ensureVectorAccountInitialized, getVectorNonce, wrapMakerSolIfNeeded } from "@/lib/swap-transactions";
import { createDeterministicKeypair, signAdvanceInstruction, vectorIdentity } from "@/lib/vector";
import { getCurrentWalletAddress } from "@/lib/wallet-adapters";
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
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (connected && (connectedAddress || connectedWalletName)) {
    setConnectedAddress(undefined);
    setConnectedWalletName(undefined);
  }
  const address = account?.address ?? connectedAddress;
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

  async function createMakerSignedLink() {
    if (!address) throw new Error("Connect the maker wallet first.");
    setBusy(true);
    setError(undefined);
    setStatus("Building maker-authorized swap...");

    try {
      const makerAddress = new Address(address);
      const takerAddress = new Address(form.takerAddress);
      const connection = new Connection(cluster.url, "confirmed");
      const vectorKeypair = createDeterministicKeypair(makerAddress);
      const identity = vectorIdentity(vectorKeypair.publicKey);
      await ensureVectorAccountInitialized(connection, makerAddress, vectorKeypair, identity, connectedWalletName, cluster, setStatus);
      await wrapMakerSolIfNeeded(connection, makerAddress, identity, form, connectedWalletName, cluster, setStatus);
      const { passthroughIx, setupIxs, takerTransferIx } = await buildSwapAuthorization(connection, makerAddress, identity, form);
      const advanceIx = signAdvanceInstruction(vectorKeypair, await getVectorNonce(connection, identity), setupIxs, [passthroughIx, takerTransferIx], takerAddress);
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
      });

      const link = new URL(`/swap/${offer.id}`, window.location.origin);
      setGeneratedLink(link.toString());
      setStatus(`Maker signed the Vector digest for ${passthroughIx.keys.length} passthrough accounts. Link is ready for the taker.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create maker-signed swap link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-violet-950/30 backdrop-blur sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-violet-200/70">Peer swap</p>
          <h2 className="mt-1 text-2xl font-semibold">Vector-signed token exchange</h2>
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
        <InfoRow label="Maker address" value={address ?? "Not connected"} mono />
      </div>

      <form className="mt-5 grid gap-4" onSubmit={(event) => event.preventDefault()}>
        <Field label="Taker address" value={form.takerAddress} onChange={(takerAddress) => setForm((current) => ({ ...current, takerAddress }))} />
        <SwapSideCard title="Send">
          <TokenPickerButton token={makerSendToken} tokenAddress={form.makerSendTokenAddress} placeholder="Token" onClick={() => setTokenPickerMode("maker-send")} />
          <Field label="Amount to send" hideLabel value={form.makerSendAmount} onChange={(makerSendAmount) => setForm((current) => ({ ...current, makerSendAmount }))} inputMode="decimal" placeholder="0.00" />
        </SwapSideCard>
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

      <div className="mt-5 grid gap-3">
        <ActionButton disabled={busy || !isConnected} onClick={() => void createMakerSignedLink()}>Create swap link</ActionButton>
      </div>

      {generatedLink ? <InfoRow label="Generated link" value={generatedLink} mono /> : null}
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
