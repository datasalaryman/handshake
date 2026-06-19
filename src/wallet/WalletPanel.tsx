import { Address, Connection, SystemProgram, Transaction, type TransactionSignature } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { getWallets } from "@wallet-standard/app";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { ChevronDown } from "lucide-react";
import { WalletUiIcon, useWalletUi, type UiWallet } from "@wallet-ui/react";
import { useDeferredValue, useEffect, useState } from "react";
import { orpc } from "../lib/orpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { VECTOR, createAdvanceInstruction, createCloseSubinstruction, createDeterministicKeypair, createInitializeInstruction, createPassthroughInstruction, findVectorPda, signAdvanceInstruction, vectorIdentity, type VectorKeypair } from "../lib/vector";
import type { SwapOffer } from "../swaps/swapServer";
import { appClusters, defaultCluster, isDevelopmentEnvironment, type AppCluster } from "./clusters";
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

const wrappedSolMintAddress = "So11111111111111111111111111111111111111112";
export function WalletPanel({ swapId }: { swapId?: string }) {
  return (
    <SolanaProvider>
      <SwapCard swapId={swapId} />
    </SolanaProvider>
  );
}

function SwapCard({ swapId }: { swapId?: string }) {
  const { account, connected, disconnect, wallets } = useWalletUi();
  const [clusterId, setClusterId] = useState<AppCluster["id"]>(defaultCluster.id);
  const [connectedWalletName, setConnectedWalletName] = useState<string>();
  const [connectedAddress, setConnectedAddress] = useState<string>();
  const [form, setForm] = useState<SwapFormState>(defaultSwapForm);
  const [makerSendToken, setMakerSendToken] = useState<TokenSearchResult | undefined>(solToken);
  const [takerSendToken, setTakerSendToken] = useState<TokenSearchResult | undefined>(usdcToken);
  const [tokenPickerMode, setTokenPickerMode] = useState<"maker-send" | "taker-send">();
  const [loadedOffer, setLoadedOffer] = useState<SwapOffer>();
  const [generatedLink, setGeneratedLink] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const address = account?.address ?? connectedAddress;
  const cluster = appClusters.find((clusterOption) => clusterOption.id === clusterId) ?? defaultCluster;
  const isConnected = connected || Boolean(connectedAddress);
  const isSwapLink = Boolean(swapId);

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
    if (!swapId) return;
    const id = swapId;

    async function loadSwap() {
      try {
        const offer = await orpc.swapOffers.get({ id });
        setLoadedOffer(offer);
        const offerClusterId = offer.clusterId as AppCluster["id"];
        setClusterId(appClusters.some((clusterOption) => clusterOption.id === offerClusterId) ? offerClusterId : defaultCluster.id);
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
  }, [swapId]);

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
      setLoadedOffer({ ...offer, vectorSignature });
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
          <h2 className="mt-1 text-2xl font-semibold">{isSwapLink ? "Take Vector-signed swap" : "Vector-signed token exchange"}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDevelopmentEnvironment ? <ClusterSelector cluster={cluster} onClusterChange={setClusterId} /> : null}
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
        <InfoRow label={isSwapLink ? "Connected taker address" : "Maker address"} value={address ?? "Not connected"} mono />
      </div>

      {isSwapLink ? (
        <SwapDetails offer={loadedOffer} />
      ) : (
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
      )}

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
        {isSwapLink ? (
          <ActionButton disabled={busy || !isConnected || !loadedOffer || loadedOffer.status === "submitted"} onClick={() => void executeLoadedSwap()}>Take swap</ActionButton>
        ) : (
          <ActionButton disabled={busy || !isConnected} onClick={() => void createMakerSignedLink()}>Create swap link</ActionButton>
        )}
      </div>

      {generatedLink ? <InfoRow label="Generated link" value={generatedLink} mono /> : null}
      {status ? <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">{status}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{error}</p> : null}
    </div>
  );
}

async function ensureVectorAccountInitialized(connection: Connection, makerAddress: Address, vectorKeypair: VectorKeypair, identity: Uint8Array, walletName: string | undefined, cluster: AppCluster, setStatus: (status: string) => void) {
  await assertVectorProgramDeployed(connection);
  const [makerVectorPda] = findVectorPda(identity);
  const existingVectorAccount = await connection.getAccountInfo(makerVectorPda);
  if (existingVectorAccount) return;

  setStatus("Initializing maker Vector account...");
  const rentTopUpLamports = Number(await connection.getMinimumBalanceForRentExemption(33 + VECTOR.storedIdentityLen));
  const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(
    createInitializeInstruction(makerAddress, vectorKeypair.publicKey),
    SystemProgram.transfer({ fromPubkey: makerAddress, toPubkey: makerVectorPda, lamports: rentTopUpLamports }),
  );
  await simulateTransaction(connection, tx);
  const signature = await signAndSendWalletTransaction(walletName, tx, cluster, connection);
  await confirmTransaction(connection, signature);
}

async function wrapMakerSolIfNeeded(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState, walletName: string | undefined, cluster: AppCluster, setStatus: (status: string) => void) {
  if (form.makerSendTokenAddress !== wrappedSolMintAddress) return;

  const makerSendMint = new Address(form.makerSendTokenAddress);
  const makerSendMintInfo = await getMint(connection, makerSendMint);
  const requiredAmount = parseTokenAmount(form.makerSendAmount, makerSendMintInfo.decimals);
  const [makerVectorPda] = findVectorPda(identity);
  const makerSendSource = getAssociatedTokenAddressSync(makerSendMint, makerVectorPda, true);
  const existingAmount = await getTokenAccountAmount(connection, makerSendSource);
  const missingAmount = requiredAmount - existingAmount;
  if (missingAmount <= 0n) return;
  if (missingAmount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Maker SOL wrap amount is too large for this transaction.");

  setStatus("Wrapping maker SOL into the Vector PDA token account...");
  const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(
    createAssociatedTokenAccountIdempotentInstruction(makerAddress, makerSendSource, makerVectorPda, makerSendMint),
    SystemProgram.transfer({ fromPubkey: makerAddress, toPubkey: makerSendSource, lamports: Number(missingAmount) }),
    createSyncNativeInstruction(makerSendSource),
  );
  await simulateTransaction(connection, tx);
  const signature = await signAndSendWalletTransaction(walletName, tx, cluster, connection);
  await confirmTransaction(connection, signature);
}

async function getTokenAccountAmount(connection: Connection, tokenAccount: Address) {
  try {
    const account = await getAccount(connection, tokenAccount);
    return account.amount;
  } catch {
    return 0n;
  }
}

async function assertVectorProgramDeployed(connection: Connection) {
  const programAccount = await connection.getAccountInfo(VECTOR.programId);
  if (!programAccount?.executable) {
    throw new Error("Vector program is not available on this RPC. Restart Surfpool with: bun run surfnet");
  }
}

async function buildSwapAuthorization(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState | SwapOffer) {
  const makerSendMint = new Address(form.makerSendTokenAddress);
  const takerSendMint = new Address(form.takerSendTokenAddress);
  const takerAddress = new Address(form.takerAddress);
  const [makerVectorPda] = findVectorPda(identity);
  const vectorAccount = await connection.getAccountInfo(makerVectorPda);
  if (!vectorAccount?.data || vectorAccount.data.length < 33) throw new Error("Maker Vector account is not initialized on this cluster.");

  const makerSendMintInfo = await getMint(connection, makerSendMint);
  const takerSendMintInfo = await getMint(connection, takerSendMint);
  const makerSendAmount = parseTokenAmount(form.makerSendAmount, makerSendMintInfo.decimals);
  const takerSendAmount = parseTokenAmount(form.takerSendAmount, takerSendMintInfo.decimals);
  const makerSendSource = getAssociatedTokenAddressSync(makerSendMint, makerVectorPda, true);
  const makerSendDestination = getAssociatedTokenAddressSync(makerSendMint, takerAddress);
  const takerSendSource = getAssociatedTokenAddressSync(takerSendMint, takerAddress);
  const takerSendDestination = getAssociatedTokenAddressSync(takerSendMint, makerAddress);
  const setupIxs = await createMissingAtaInstructions(connection, takerAddress, [
    { ata: makerSendSource, owner: makerVectorPda, mint: makerSendMint },
    { ata: makerSendDestination, owner: takerAddress, mint: makerSendMint },
    { ata: takerSendSource, owner: takerAddress, mint: takerSendMint },
    { ata: takerSendDestination, owner: makerAddress, mint: takerSendMint },
  ]);
  setupIxs.push(...await createTakerWrapSolInstructions(connection, takerAddress, takerSendSource, takerSendMint, takerSendAmount));
  const makerTransfer = createTransferInstruction(makerSendSource, makerSendDestination, makerVectorPda, makerSendAmount);
  const takerTransfer = createTransferInstruction(takerSendSource, takerSendDestination, takerAddress, takerSendAmount);
  const closeVector = createCloseSubinstruction(identity, makerAddress);
  const passthroughIx = createPassthroughInstruction(identity, [makerTransfer, closeVector]);
  return { setupIxs, passthroughIx, takerTransferIx: takerTransfer };
}

async function getVectorNonce(connection: Connection, identity: Uint8Array) {
  const [makerVectorPda] = findVectorPda(identity);
  const vectorAccount = await connection.getAccountInfo(makerVectorPda);
  if (!vectorAccount?.data || vectorAccount.data.length < 33) throw new Error("Maker Vector account is not initialized on this cluster.");
  return vectorAccount.data.slice(0, 32);
}

async function createMissingAtaInstructions(connection: Connection, payer: Address, accounts: { ata: Address; owner: Address; mint: Address }[]) {
  const infos = await connection.getMultipleAccountsInfo(accounts.map((account) => account.ata));
  return accounts.flatMap((account, index) => {
    if (infos[index]) return [];
    return [createAssociatedTokenAccountIdempotentInstruction(payer, account.ata, account.owner, account.mint)];
  });
}

async function createTakerWrapSolInstructions(connection: Connection, takerAddress: Address, takerSendSource: Address, takerSendMint: Address, requiredAmount: bigint) {
  if (takerSendMint.toString() !== wrappedSolMintAddress) return [];

  const existingAmount = await getTokenAccountAmount(connection, takerSendSource);
  const missingAmount = requiredAmount - existingAmount;
  if (missingAmount <= 0n) return [];
  if (missingAmount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Taker SOL wrap amount is too large for this transaction.");

  return [
    SystemProgram.transfer({ fromPubkey: takerAddress, toPubkey: takerSendSource, lamports: Number(missingAmount) }),
    createSyncNativeInstruction(takerSendSource),
  ];
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
  if (result.value.err) {
    const logs = result.value.logs?.join("\n") ?? "No simulation logs returned.";
    throw new Error(`Simulation failed: ${stringifyRpcError(result.value.err)}\n${logs}`);
  }
}

function stringifyRpcError(error: unknown) {
  return JSON.stringify(error, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

async function confirmTransaction(connection: Connection, signature: TransactionSignature) {
  if (!signature || signature.length < 80) return;
  const blockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
}

async function signAndSendWalletTransaction(walletName: string | undefined, tx: Transaction, cluster: AppCluster, connection: Connection) {
  const standardWallet = getRegisteredWallet(walletName);
  const account = standardWallet?.accounts[0];
  const serialized = await tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const chain = cluster.id as `${string}:${string}`;
  const signFeature = standardWallet?.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction] | undefined;
  if (signFeature && account) {
    const [result] = await signFeature.signTransaction({ account, transaction: serialized, chain, options: { preflightCommitment: "confirmed" } });
    if (!result?.signedTransaction) throw new Error("Wallet did not return a signed transaction.");
    return sendSignedTransaction(connection, result.signedTransaction, cluster);
  }

  const signAndSendFeature = standardWallet?.features[SolanaSignAndSendTransaction] as SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction] | undefined;
  if (signAndSendFeature && account) {
    if (cluster.id === "solana:localnet") throw new Error("This wallet only exposed sign-and-send. For Surfnet, use a wallet/account that supports signTransaction, or set the wallet's RPC/network to http://127.0.0.1:8899.");
    const [result] = await signAndSendFeature.signAndSendTransaction({ account, transaction: serialized, chain, options: { commitment: "confirmed" } });
    if (!result?.signature) throw new Error("Wallet did not return a transaction signature.");
    return bytesToBase58(result.signature);
  }

  const provider = getLegacySolanaProvider(walletName);
  if (provider?.signTransaction) {
    const signed = await provider.signTransaction(tx);
    return sendSignedTransaction(connection, await signed.serialize(), cluster);
  }
  if (provider?.signAndSendTransaction) {
    if (cluster.id === "solana:localnet") throw new Error("This wallet only exposed sign-and-send. For Surfnet, use a wallet/account that supports signTransaction, or set the wallet's RPC/network to http://127.0.0.1:8899.");
    const result = await provider.signAndSendTransaction(tx);
    if (result?.signature) return result.signature;
  }

  throw new Error("Connected wallet does not expose Solana transaction signing.");
}

async function sendSignedTransaction(connection: Connection, signedTransaction: Uint8Array, cluster: AppCluster) {
  const signature = await connection.sendRawTransaction(signedTransaction, {
    preflightCommitment: "confirmed",
    skipPreflight: cluster.id === "solana:localnet",
  });
  await confirmTransaction(connection, signature);
  return signature;
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

function SwapDetails({ offer }: { offer: SwapOffer | undefined }) {
  if (!offer) {
    return <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Loading swap details...</p>;
  }

  return (
    <div className="mt-5 grid gap-4">
      <InfoRow label="Maker address" value={offer.makerAddress} mono />
      <InfoRow label="Taker address" value={offer.takerAddress} mono />
      <SwapSideCard title="Maker sends">
        <ReadOnlyValue label="Token sent" value={offer.makerSendTokenAddress} mono />
        <ReadOnlyValue label="Amount" value={offer.makerSendAmount} />
      </SwapSideCard>
      <SwapSideCard title="Taker sends">
        <ReadOnlyValue label="Token sent" value={offer.takerSendTokenAddress} mono />
        <ReadOnlyValue label="Amount" value={offer.takerSendAmount} />
      </SwapSideCard>
      <SwapSideCard title="Swap details">
        <ReadOnlyValue label="Maker receives token" value={offer.takerSendTokenAddress} mono />
        <ReadOnlyValue label="Taker receives token" value={offer.makerSendTokenAddress} mono />
      </SwapSideCard>
    </div>
  );
}

function ReadOnlyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-2 break-all ${mono ? "font-mono text-sm" : "text-base font-semibold"} text-white`}>{value}</p>
    </div>
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

function encodeVectorAuthorization(identity: Uint8Array, signature: Uint8Array) {
  return `${bytesToBase64(identity)}.${bytesToBase64(signature)}`;
}

function decodeVectorAuthorization(value: string) {
  const [identityBase64, signatureBase64] = value.split(".");
  if (!identityBase64 || !signatureBase64) throw new Error("Swap offer is missing Vector authorization data.");
  return {
    identity: base64ToBytes(identityBase64),
    signature: base64ToBytes(signatureBase64),
  };
}

function bytesToBase58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];

  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += alphabet[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) result += alphabet[digits[i]!];
  return result;
}
