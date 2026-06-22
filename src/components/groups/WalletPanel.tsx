import { Address, Connection, SystemProgram, Transaction, type TransactionSignature } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { useWalletUi } from "@wallet-ui/react";
import { useEffect, useState } from "react";
import { SolanaProvider, appClusters, defaultCluster, isDevelopmentEnvironment, type AppCluster } from "@/components/providers/SolanaProvider";
import { SwapDetails } from "@/components/groups/SwapDetails";
import { TokenPickerModal } from "@/components/groups/TokenPickerModal";
import { WalletSelector } from "@/components/groups/WalletSelector";
import { ActionButton } from "@/components/units/ActionButton";
import { ClusterSelector } from "@/components/units/ClusterSelector";
import { Field } from "@/components/units/Field";
import { InfoRow } from "@/components/units/InfoRow";
import { SwapSideCard } from "@/components/units/SwapSideCard";
import { TokenPickerButton } from "@/components/units/TokenPickerButton";
import { orpc } from "@/lib/orpc";
import { VECTOR, createAdvanceInstruction, createCloseSubinstruction, createDeterministicKeypair, createInitializeInstruction, createPassthroughInstruction, findVectorPda, signAdvanceInstruction, vectorIdentity, type VectorKeypair } from "@/lib/vector";
import { getCurrentWalletAddress, getLegacySolanaProvider, getRegisteredWallet } from "@/lib/wallet-adapters";
import type { SwapFormState, TokenSearchResult } from "@/lib/wallet-types";
import type { SwapOffer } from "@/orpc/schema";

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
