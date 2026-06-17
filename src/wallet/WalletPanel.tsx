import { Address, Connection, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getMint, createTransferCheckedInstruction } from "@solana/spl-token";
import { getWallets } from "@wallet-standard/app";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { ChevronDown } from "lucide-react";
import { WalletUiIcon, useWalletUi, type UiWallet } from "@wallet-ui/react";
import { useDeferredValue, useEffect, useState } from "react";
import { orpc } from "../lib/orpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ED25519, advanceVectorDigest, createAdvanceInstruction, createInitializeEd25519, createPassthroughInstruction, findVectorPda } from "../lib/vector";
import type { SwapOffer } from "../swaps/swapServer";
import { appClusters, defaultCluster, type AppCluster } from "./clusters";
import { SolanaProvider } from "./SolanaProvider";

type SwapFormState = {
  makerSendTokenAddress: string;
  makerSendAmount: string;
  takerAddress: string;
  takerSendTokenAddress: string;
  takerSendAmount: string;
};

type TokenSearchResult = {
  address: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  isVerified: boolean;
  organicScore?: number;
  organicScoreLabel?: "high" | "medium" | "low";
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  isSus: boolean;
};

const solToken: TokenSearchResult = {
  address: "So11111111111111111111111111111111111111112",
  name: "Wrapped SOL",
  symbol: "SOL",
  icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  decimals: 9,
  isVerified: true,
  organicScoreLabel: "high",
  isSus: false,
};

const usdtToken: TokenSearchResult = {
  address: "Es9vMFrzaCERmJfrF4H2FYD4GTGKTqGk53JTh2S",
  name: "USDT",
  symbol: "USDT",
  icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4GTGKTqGk53JTh2S/logo.svg",
  decimals: 6,
  isVerified: true,
  organicScoreLabel: "high",
  isSus: false,
};

const defaultSwapForm: SwapFormState = {
  makerSendTokenAddress: solToken.address,
  makerSendAmount: "",
  takerAddress: "",
  takerSendTokenAddress: usdtToken.address,
  takerSendAmount: "",
};

export function WalletPanel() {
  return (
    <SolanaProvider>
      <SwapCard />
    </SolanaProvider>
  );
}

function SwapCard() {
  const { account, connected, disconnect, wallets } = useWalletUi();
  const [clusterId, setClusterId] = useState<AppCluster["id"]>(defaultCluster.id);
  const [connectedWalletName, setConnectedWalletName] = useState<string>();
  const [connectedAddress, setConnectedAddress] = useState<string>();
  const [form, setForm] = useState<SwapFormState>(defaultSwapForm);
  const [makerSendToken, setMakerSendToken] = useState<TokenSearchResult | undefined>(solToken);
  const [takerSendToken, setTakerSendToken] = useState<TokenSearchResult | undefined>(usdtToken);
  const [tokenPickerMode, setTokenPickerMode] = useState<"maker-send" | "taker-send">();
  const [loadedOffer, setLoadedOffer] = useState<SwapOffer>();
  const [generatedLink, setGeneratedLink] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const address = account?.address ?? connectedAddress;
  const cluster = appClusters.find((clusterOption) => clusterOption.id === clusterId) ?? defaultCluster;
  const isConnected = connected || Boolean(connectedAddress);
  const makerIdentity = address ? new Address(address).toBytes() : undefined;
  const vectorPda = makerIdentity ? findVectorPda(ED25519, makerIdentity)[0].toString() : "Connect wallet";

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

  useEffect(() => {
    const swapId = new URLSearchParams(window.location.search).get("swap");
    if (!swapId) return;
    const id = swapId;

    async function loadSwap() {
      try {
        const offer = await orpc.swapOffers.get({ id });
        setLoadedOffer(offer);
        setClusterId(offer.clusterId as AppCluster["id"]);
        setForm({
          makerSendTokenAddress: offer.makerSendTokenAddress,
          makerSendAmount: offer.makerSendAmount,
          takerAddress: offer.takerAddress,
          takerSendTokenAddress: offer.takerSendTokenAddress,
          takerSendAmount: offer.takerSendAmount,
        });
        setMakerSendToken(undefined);
        setTakerSendToken(undefined);
        setStatus("Loaded maker-signed swap offer.");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not load swap offer.");
      }
    }

    void loadSwap();
  }, []);

  async function initializeVectorAccount() {
    if (!address) throw new Error("Connect the maker wallet first.");
    setBusy(true);
    setError(undefined);
    setStatus("Preparing Vector account initialization...");

    try {
      const connection = new Connection(cluster.url, "confirmed");
      const makerAddress = new Address(address);
      const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(createInitializeEd25519(makerAddress, makerAddress.toBytes()));
      const signature = await signAndSendWalletTransaction(connectedWalletName, tx, cluster, connection);
      setStatus(`Vector account initialized: ${signature}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not initialize Vector account.");
    } finally {
      setBusy(false);
    }
  }

  async function createMakerSignedLink() {
    if (!address) throw new Error("Connect the maker wallet first.");
    setBusy(true);
    setError(undefined);
    setStatus("Building maker-authorized swap...");

    try {
      const makerAddress = new Address(address);
      const takerAddress = new Address(form.takerAddress);
      const connection = new Connection(cluster.url, "confirmed");
      const { passthroughIx, digest } = await buildSwapAuthorization(connection, makerAddress, form);
      const vectorSignature = await signWalletMessage(connectedWalletName, makerAddress.toString(), digest);
      createAdvanceInstruction(ED25519, makerAddress.toBytes(), vectorSignature);

      const offer = await orpc.swapOffers.create({
        clusterId: cluster.id,
        makerAddress: makerAddress.toString(),
        makerSendTokenAddress: form.makerSendTokenAddress,
        makerSendAmount: form.makerSendAmount,
        takerAddress: takerAddress.toString(),
        takerSendTokenAddress: form.takerSendTokenAddress,
        takerSendAmount: form.takerSendAmount,
        vectorSignature: bytesToBase64(vectorSignature),
      });

      const link = new URL(window.location.href);
      link.searchParams.set("swap", offer.id);
      setGeneratedLink(link.toString());
      setLoadedOffer({ ...offer, vectorSignature: bytesToBase64(vectorSignature) });
      setStatus(`Maker signed the Vector digest for ${passthroughIx.keys.length} passthrough accounts. Link is ready for the taker.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create maker-signed swap link.");
    } finally {
      setBusy(false);
    }
  }

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
      const { passthroughIx } = await buildSwapAuthorization(connection, makerAddress, loadedOffer);
      const advanceIx = createAdvanceInstruction(ED25519, makerAddress.toBytes(), base64ToBytes(loadedOffer.vectorSignature));
      const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: takerAddress }).add(advanceIx, passthroughIx);

      await simulateTransaction(connection, tx);
      const signature = await signAndSendWalletTransaction(connectedWalletName, tx, cluster, connection);
      const updatedOffer = await orpc.swapOffers.markSubmitted({ id: loadedOffer.id, submittedSignature: signature });
      setLoadedOffer(updatedOffer);
      setStatus(`Swap submitted: ${signature}`);
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
          <h2 className="mt-1 text-2xl font-semibold">Vector-signed token exchange</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <ClusterSelector cluster={cluster} onClusterChange={setClusterId} />
          {!isConnected ? <WalletSelector wallets={wallets} onConnect={(walletName, address) => {
            setConnectedWalletName(walletName);
            setConnectedAddress(address);
          }} onError={setError} /> : null}
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

      <div className="grid gap-3">
        <InfoRow label="Make address" value={address ?? "Not connected"} mono />
        <InfoRow label="Maker Vector PDA" value={vectorPda} mono />
      </div>

      <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
        Maker transfer uses Vector as the token-account delegate. Before sharing a link, approve the Maker Vector PDA as delegate for the maker send token account with at least the send amount.
      </div>

      <form className="mt-5 grid gap-4" onSubmit={(event) => event.preventDefault()}>
        <SwapSideCard title="Send">
          <TokenPickerButton token={makerSendToken} tokenAddress={form.makerSendTokenAddress} placeholder="Token" onClick={() => setTokenPickerMode("maker-send")} />
          <Field label="Amount to send" hideLabel value={form.makerSendAmount} onChange={(makerSendAmount) => setForm((current) => ({ ...current, makerSendAmount }))} inputMode="decimal" placeholder="0.00" />
        </SwapSideCard>
        <Field label="Taker address" value={form.takerAddress} onChange={(takerAddress) => setForm((current) => ({ ...current, takerAddress }))} />
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

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <ActionButton disabled={busy || !isConnected} onClick={() => void initializeVectorAccount()}>Initialize Vector</ActionButton>
        <ActionButton disabled={busy || !isConnected} onClick={() => void createMakerSignedLink()}>Maker sign link</ActionButton>
        <ActionButton disabled={busy || !isConnected || !loadedOffer} onClick={() => void executeLoadedSwap()}>Taker sign and send</ActionButton>
      </div>

      {generatedLink ? <InfoRow label="Generated link" value={generatedLink} mono /> : null}
      {status ? <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">{status}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{error}</p> : null}
    </div>
  );
}

async function buildSwapAuthorization(connection: Connection, makerAddress: Address, form: SwapFormState | SwapOffer) {
  const makerSendMint = new Address(form.makerSendTokenAddress);
  const takerSendMint = new Address(form.takerSendTokenAddress);
  const takerAddress = new Address(form.takerAddress);
  const [makerVectorPda] = findVectorPda(ED25519, makerAddress.toBytes());
  const vectorAccount = await connection.getAccountInfo(makerVectorPda);
  if (!vectorAccount?.data || vectorAccount.data.length < 33) throw new Error("Maker Vector account is not initialized on this cluster.");

  const makerSendMintInfo = await getMint(connection, makerSendMint);
  const takerSendMintInfo = await getMint(connection, takerSendMint);
  const makerSendAmount = parseTokenAmount(form.makerSendAmount, makerSendMintInfo.decimals);
  const takerSendAmount = parseTokenAmount(form.takerSendAmount, takerSendMintInfo.decimals);
  const makerSendSource = getAssociatedTokenAddressSync(makerSendMint, makerAddress);
  const makerSendDestination = getAssociatedTokenAddressSync(makerSendMint, takerAddress);
  const takerSendSource = getAssociatedTokenAddressSync(takerSendMint, takerAddress);
  const takerSendDestination = getAssociatedTokenAddressSync(takerSendMint, makerAddress);
  const makerTransfer = createTransferCheckedInstruction(makerSendSource, makerSendMint, makerSendDestination, makerVectorPda, makerSendAmount, makerSendMintInfo.decimals);
  const takerTransfer = createTransferCheckedInstruction(takerSendSource, takerSendMint, takerSendDestination, takerAddress, takerSendAmount, takerSendMintInfo.decimals);
  const passthroughIx = createPassthroughInstruction(ED25519, makerAddress.toBytes(), [makerTransfer, takerTransfer]);
  const digest = advanceVectorDigest(ED25519, vectorAccount.data.slice(0, 32), makerAddress.toBytes(), [], [passthroughIx], takerAddress);

  return { passthroughIx, digest };
}

function parseTokenAmount(amount: string, decimals: number) {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid token amount: ${amount}`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error(`Amount ${amount} has more than ${decimals} decimals.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

async function simulateTransaction(connection: Connection, tx: Transaction) {
  const result = await connection.simulateTransaction(tx);
  if (result.value.err) throw new Error(`Simulation failed: ${JSON.stringify(result.value.err)}`);
}

async function signWalletMessage(walletName: string | undefined, address: string, message: Uint8Array) {
  const standardWallet = getRegisteredWallet(walletName);
  const account = standardWallet?.accounts.find((account) => account.address === address) ?? standardWallet?.accounts[0];
  const feature = standardWallet?.features[SolanaSignMessage] as SolanaSignMessageFeature[typeof SolanaSignMessage] | undefined;

  if (feature && account) {
    const [result] = await feature.signMessage({ account, message });
    if (!result?.signature) throw new Error("Wallet did not return a message signature.");
    return result.signature;
  }

  const provider = getLegacySolanaProvider(walletName);
  const signed = await provider?.signMessage?.(message, "utf8");
  if (signed?.signature) return signed.signature;

  throw new Error("Connected wallet does not expose Solana message signing.");
}

async function signAndSendWalletTransaction(walletName: string | undefined, tx: Transaction, cluster: AppCluster, connection: Connection) {
  const standardWallet = getRegisteredWallet(walletName);
  const account = standardWallet?.accounts[0];
  const serialized = await tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const chain = cluster.id as `${string}:${string}`;
  const signAndSendFeature = standardWallet?.features[SolanaSignAndSendTransaction] as SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction] | undefined;

  if (signAndSendFeature && account) {
    const [result] = await signAndSendFeature.signAndSendTransaction({ account, transaction: serialized, chain, options: { commitment: "confirmed" } });
    if (!result?.signature) throw new Error("Wallet did not return a transaction signature.");
    return bytesToBase64(result.signature);
  }

  const signFeature = standardWallet?.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction] | undefined;
  if (signFeature && account) {
    const [result] = await signFeature.signTransaction({ account, transaction: serialized, chain, options: { preflightCommitment: "confirmed" } });
    if (!result?.signedTransaction) throw new Error("Wallet did not return a signed transaction.");
    return connection.sendRawTransaction(result.signedTransaction);
  }

  const provider = getLegacySolanaProvider(walletName);
  if (provider?.signAndSendTransaction) {
    const result = await provider.signAndSendTransaction(tx);
    if (result?.signature) return result.signature;
  }
  if (provider?.signTransaction) {
    const signed = await provider.signTransaction(tx);
    return connection.sendRawTransaction(await signed.serialize());
  }

  throw new Error("Connected wallet does not expose Solana transaction signing.");
}

function Field({ label, value, onChange, inputMode, placeholder, hideLabel }: { label: string; value: string; onChange: (value: string) => void; inputMode?: "decimal"; placeholder?: string; hideLabel?: boolean }) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <label className="grid gap-2 text-sm text-slate-200" htmlFor={id}>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
      <input
        className="h-full min-h-12 rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-300/60"
        id={id}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SwapSideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[0.7fr_1fr]">{children}</div>
    </section>
  );
}

function TokenPickerButton({ token, tokenAddress, placeholder, onClick }: { token: TokenSearchResult | undefined; tokenAddress: string; placeholder: string; onClick: () => void }) {
  return (
    <div>
      <button className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-left outline-none transition hover:border-violet-300/50 hover:bg-white/[0.1] focus:border-violet-300/60" type="button" onClick={onClick}>
        {token ? (
          <span className="flex min-w-0 items-center gap-2">
            <TokenIcon token={token} compact />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">{token.symbol}</span>
            </span>
          </span>
        ) : tokenAddress ? (
          <span className="min-w-0">
            <span className="block truncate font-mono text-xs text-white">{abbreviateAddress(tokenAddress)}</span>
          </span>
        ) : (
          <span className="text-sm font-semibold text-slate-200">{placeholder}</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-slate-400" />
      </button>
    </div>
  );
}

function TokenPickerModal({ selectedToken, title, onClose, onSelect }: { selectedToken: TokenSearchResult | undefined; title: string; onClose: () => void; onSelect: (token: TokenSearchResult) => void }) {
  const [query, setQuery] = useState(selectedToken?.symbol ?? selectedToken?.address ?? "SOL");
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<TokenSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    async function searchTokens() {
      try {
        const tokens = await orpc.tokens.search({ query: trimmedQuery });
        if (!cancelled) setResults(tokens as TokenSearchResult[]);
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not search tokens.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timeout = window.setTimeout(searchTokens, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [deferredQuery]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="token-picker-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0b0d16] shadow-2xl shadow-black/50" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <h3 className="text-lg font-semibold text-white" id="token-picker-title">{title}</h3>
          <button className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="p-5">
          <label className="grid gap-2 text-sm text-slate-200" htmlFor="token-search">
            Search by token name, symbol, or address
            <input
              autoFocus
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-violet-300/60"
              id="token-search"
              placeholder="SOL, USDC, Jupiter, or mint address"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="mt-4 max-h-[420px] overflow-y-auto pr-1">
            {loading ? <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Searching Jupiter tokens...</p> : null}
            {error ? <p className="rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{error}</p> : null}
            {!loading && !error && results.length === 0 ? <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">No tokens found.</p> : null}
            <div className="grid gap-2">
              {results.map((token) => (
                <button className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-violet-300/50 hover:bg-white/[0.08]" key={token.address} type="button" onClick={() => onSelect(token)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <TokenIcon token={token} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold text-white">{token.symbol}</span>
                        {token.isVerified ? <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">Verified</span> : null}
                      </span>
                      <span className="block truncate text-sm text-slate-300">{token.name}</span>
                      <span className="block truncate font-mono text-xs text-slate-500">{abbreviateAddress(token.address)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-400">
                    {token.usdPrice ? <span className="block text-slate-200">{formatUsd(token.usdPrice)}</span> : null}
                    {token.organicScoreLabel ? <span className="block capitalize">{token.organicScoreLabel} score</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenIcon({ token, compact }: { token: TokenSearchResult; compact?: boolean }) {
  const sizeClassName = compact ? "size-6" : "size-10";

  if (token.icon) {
    return <img alt="" className={`${sizeClassName} rounded-full bg-white/10 object-cover`} src={token.icon} />;
  }

  return <span className={`${sizeClassName} flex items-center justify-center rounded-full bg-violet-200 text-xs font-semibold text-slate-950`}>{token.symbol.slice(0, 2).toUpperCase()}</span>;
}

function abbreviateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatUsd(value: number) {
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString(undefined, { maximumSignificantDigits: 3 })}`;
}

function ActionButton({ children, disabled, onClick }: { children: string; disabled: boolean; onClick: () => void }) {
  return (
    <button className="rounded-xl bg-violet-200 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function ClusterSelector({ cluster, onClusterChange }: { cluster: AppCluster; onClusterChange: (clusterId: AppCluster["id"]) => void }) {
  return (
    <>
      <label className="sr-only" htmlFor="cluster-select">Cluster</label>
      <select className="rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-100" id="cluster-select" value={cluster.id} onChange={(event) => onClusterChange(event.target.value as AppCluster["id"])}>
        {appClusters.map((clusterOption) => <option key={clusterOption.id} value={clusterOption.id}>{clusterOption.label}</option>)}
      </select>
    </>
  );
}

function WalletSelector({ wallets, onConnect, onError }: { wallets: UiWallet[]; onConnect: (walletName: string, address: string) => void; onError: (error: string | undefined) => void }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWalletName, setSelectedWalletName] = useState("");

  return (
    <Select disabled={isConnecting || !wallets.length} value={selectedWalletName} onValueChange={async (walletName) => {
        const wallet = wallets.find((walletOption) => walletOption.name === walletName);
        if (!wallet) return;

        setSelectedWalletName(walletName);
        onError(undefined);
        setIsConnecting(true);
        try {
          const address = wallet.features.includes("standard:connect") ? await connectStandardWallet(wallet) : await connectLegacyWallet(wallet);
          onConnect(wallet.name, address);
        } catch (error) {
          onError(error instanceof Error ? error.message : "Could not connect wallet.");
          setSelectedWalletName("");
        } finally {
          setIsConnecting(false);
        }
      }}>
      <SelectTrigger className="h-auto rounded-xl border-white/10 bg-white px-4 py-2 text-sm font-semibold text-slate-950 shadow-none transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-70">
        <SelectValue placeholder={isConnecting ? "Connecting..." : wallets.length ? "Select wallet" : "No wallets"} />
      </SelectTrigger>
      <SelectContent className="border-white/10 bg-slate-950 text-white">
        {wallets.map((wallet) => (
          <SelectItem className="focus:bg-white/10 focus:text-white" key={wallet.name} value={wallet.name}>
            <span className="flex items-center gap-2">
              <WalletUiIcon className="size-5 rounded-full" wallet={wallet} />
              <span>{wallet.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

async function connectStandardWallet(wallet: UiWallet) {
  const standardWallet = getRegisteredWallet(wallet.name);
  const connectFeature = standardWallet?.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined;
  if (!standardWallet || !connectFeature) throw new Error("Wallet extension was detected, but its connect feature is unavailable. Refresh the page and try again.");

  const result = await connectFeature.connect();
  const account = result.accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? result.accounts[0];
  if (!account?.address) throw new Error("The wallet did not return a Solana account.");

  return account.address;
}

async function connectLegacyWallet(wallet: UiWallet) {
  const provider = getLegacySolanaProvider(wallet.name);
  if (!provider) throw new Error("Wallet extension is unavailable.");

  const result = await provider.connect();
  const publicKey = result?.publicKey ?? provider.publicKey;
  const address = typeof publicKey === "string" ? publicKey : publicKey?.toString();
  if (!address) throw new Error("The wallet did not return a public key.");

  return address;
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className={`mt-2 break-all ${mono ? "font-mono text-sm" : "text-base"} text-slate-100`}>{value}</p>
    </div>
  );
}

type LegacySolanaProvider = {
  connect: () => Promise<{ publicKey?: string | { toString(): string } }>;
  disconnect?: () => Promise<void>;
  publicKey?: string | { toString(): string };
  signMessage?: (message: Uint8Array, display?: string) => Promise<{ signature?: Uint8Array }>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (transaction: Transaction) => Promise<{ signature?: string }>;
};

function getRegisteredWallet(walletName: string | undefined) {
  if (!walletName) return undefined;
  return getWallets().get().find((registeredWallet) => registeredWallet.name === walletName);
}

function getLegacySolanaProvider(walletName: string | undefined): LegacySolanaProvider | undefined {
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

function getNestedSolanaProvider(provider: LegacySolanaProvider | { solana?: LegacySolanaProvider } | undefined): LegacySolanaProvider | undefined {
  if (!provider) return undefined;
  if ("connect" in provider) return provider;
  return provider.solana;
}

async function getCurrentWalletAddress(walletName: string) {
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

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
