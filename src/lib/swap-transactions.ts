import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintDecoder,
  getSyncNativeInstruction,
  getTokenDecoder,
  getTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { AccountRole, type AccountMeta as KitAccountMeta, type Address as KitAddress, type ReadonlyUint8Array, type TransactionSigner } from "@solana/kit";
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { Address, Connection, SystemProgram, Transaction, TransactionInstruction, type TransactionSignature } from "@solana/web3.js";
import type { AppCluster } from "@/components/providers/SolanaProvider";
import type { SwapOffer } from "@/orpc/schema";
import { VECTOR, createCloseSubinstruction, createInitializeInstruction, createPassthroughInstruction, findVectorPda, type VectorKeypair } from "@/lib/vector";
import { getLegacySolanaProvider, getRegisteredWallet } from "@/lib/wallet-adapters";
import type { SwapFormState } from "@/lib/wallet-types";

const wrappedSolMintAddress = "So11111111111111111111111111111111111111112";
const tokenProgramId = new Address(TOKEN_PROGRAM_ADDRESS);
const transactionConfirmationTimeoutMs = 60_000;
const transactionConfirmationPollMs = 1_000;

export async function prepareMakerVectorAccount(connection: Connection, makerAddress: Address, vectorKeypair: VectorKeypair, identity: Uint8Array, form: SwapFormState, walletName: string | undefined, cluster: AppCluster, setStatus: (status: string) => void) {
  await assertVectorProgramDeployed(connection, cluster);
  const [makerVectorPda] = findVectorPda(identity);
  const existingVectorAccount = await connection.getAccountInfo(makerVectorPda);
  let makerProofSignature: string | undefined;

  if (!existingVectorAccount) {
    setStatus("Initializing maker Vector account...");
    const rentTopUpLamports = Number(await connection.getMinimumBalanceForRentExemption(33 + VECTOR.storedIdentityLen));
    const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(
      createInitializeInstruction(makerAddress, vectorKeypair.publicKey),
      SystemProgram.transfer({ fromPubkey: makerAddress, toPubkey: makerVectorPda, lamports: rentTopUpLamports }),
    );
    await simulateTransaction(connection, tx);
    makerProofSignature = await signAndSendWalletTransaction(walletName, tx, cluster, connection);
  }

  const preparationIxs: TransactionInstruction[] = [];

  const makerSendMint = new Address(form.makerSendTokenAddress);
  const makerSendMintInfo = await getMintInfo(connection, makerSendMint);
  const requiredAmount = parseTokenAmount(form.makerSendAmount, makerSendMintInfo.decimals);
  const makerSendSource = await getAssociatedTokenAddress(makerSendMint, makerVectorPda);
  const makerSendSourceAccount = await connection.getAccountInfo(makerSendSource);
  if (!makerSendSourceAccount) {
    preparationIxs.push(createAssociatedTokenAccountIdempotentInstruction(makerAddress, makerSendSource, makerVectorPda, makerSendMint));
  }

  if (form.makerSendTokenAddress === wrappedSolMintAddress) {
    const existingAmount = await getTokenAccountAmount(connection, makerSendSource);
    const missingAmount = requiredAmount - existingAmount;
    if (missingAmount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Maker SOL wrap amount is too large for this transaction.");
    if (missingAmount > 0n) {
      preparationIxs.push(
        SystemProgram.transfer({ fromPubkey: makerAddress, toPubkey: makerSendSource, lamports: Number(missingAmount) }),
        createSyncNativeInstruction(makerSendSource),
      );
    }
  } else {
    const makerWalletSource = await getAssociatedTokenAddress(makerSendMint, makerAddress);
    const existingAmount = await getTokenAccountAmount(connection, makerSendSource);
    const missingAmount = requiredAmount - existingAmount;
    if (missingAmount > 0n) {
      await assertTokenAccountBalance(connection, makerWalletSource, missingAmount, "maker wallet source", {
        owner: makerAddress,
        mint: makerSendMint,
      });
      preparationIxs.push(createTransferInstruction(makerWalletSource, makerSendSource, makerAddress, missingAmount));
    }
  }

  let makerPreparationSignature: string | undefined;
  if (preparationIxs.length > 0) {
    setStatus("Preparing maker token account...");
    const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(...preparationIxs);
    await simulateTransaction(connection, tx);
    makerPreparationSignature = await signAndSendWalletTransaction(walletName, tx, cluster, connection);
  }

  return { makerProofSignature, makerPreparationSignature };
}

export async function buildSwapAuthorization(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState | SwapOffer) {
  const swap = await resolveSwapAccounts(connection, makerAddress, identity, form);
  const vectorAccount = await connection.getAccountInfo(swap.makerVectorPda);
  if (!vectorAccount?.data || vectorAccount.data.length < 33) throw new Error("Maker Vector account is not initialized on this cluster.");

  await assertTokenAccountBalance(connection, swap.makerSendSource, swap.makerSendAmount, "maker Vector PDA source", {
    owner: swap.makerVectorPda,
    mint: swap.makerSendMint,
  });

  const makerTransfer = createTransferInstruction(swap.makerSendSource, swap.makerSendDestination, swap.makerVectorPda, swap.makerSendAmount);
  const takerTransfer = createTransferInstruction(swap.takerSendSource, swap.takerSendDestination, swap.takerAddress, swap.takerSendAmount);
  const closeVector = createCloseSubinstruction(identity, makerAddress);
  const passthroughIx = createPassthroughInstruction(identity, [makerTransfer, closeVector]);
  return { passthroughIx, takerTransferIx: takerTransfer };
}

export async function buildSwapPreparationInstructions(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState | SwapOffer) {
  const swap = await resolveSwapAccounts(connection, makerAddress, identity, form);
  return createSwapSetupInstructions(connection, makerAddress, swap);
}

export async function buildHandshakeRevocation(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState | SwapOffer) {
  const swap = await resolveSwapAccounts(connection, makerAddress, identity, form);
  const vectorAccount = await connection.getAccountInfo(swap.makerVectorPda);
  if (!vectorAccount?.data || vectorAccount.data.length < 33) throw new Error("Maker Vector account is not initialized on this cluster.");

  const refundsWrappedSol = swap.makerSendMint.toString() === wrappedSolMintAddress;
  const makerRefundDestination = refundsWrappedSol ? undefined : await getAssociatedTokenAddress(swap.makerSendMint, makerAddress);
  const setupIxs = makerRefundDestination ? await createMissingAtaInstructions(connection, makerAddress, [
    { ata: makerRefundDestination, owner: makerAddress, mint: swap.makerSendMint },
  ]) : [];
  const escrowAccount = await connection.getAccountInfo(swap.makerSendSource);
  const subInstructions: TransactionInstruction[] = [];

  if (escrowAccount?.data) {
    const escrowAmount = getTokenDecoder().decode(escrowAccount.data).amount;
    if (escrowAmount > 0n && makerRefundDestination) {
      subInstructions.push(createTransferInstruction(swap.makerSendSource, makerRefundDestination, swap.makerVectorPda, escrowAmount));
    }
    subInstructions.push(createCloseTokenAccountInstruction(swap.makerSendSource, makerAddress, swap.makerVectorPda));
  }

  subInstructions.push(createCloseSubinstruction(identity, makerAddress));
  return { setupIxs, passthroughIx: createPassthroughInstruction(identity, subInstructions) };
}

export async function getVectorNonce(connection: Connection, identity: Uint8Array) {
  const [makerVectorPda] = findVectorPda(identity);
  const vectorAccount = await connection.getAccountInfo(makerVectorPda);
  if (!vectorAccount?.data || vectorAccount.data.length < 33) throw new Error("Maker Vector account is not initialized on this cluster.");
  return vectorAccount.data.slice(0, 32);
}

export async function simulateTransaction(connection: Connection, tx: Transaction) {
  const result = await connection.simulateTransaction(tx);
  if (result.value.err) {
    const logs = result.value.logs?.join("\n") ?? "No simulation logs returned.";
    throw new Error(`Simulation failed: ${stringifyRpcError(result.value.err)}\n${logs}`);
  }
}

export async function signAndSendWalletTransaction(walletName: string | undefined, tx: Transaction, cluster: AppCluster, connection: Connection) {
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
    const signature = bytesToBase58(result.signature);
    await confirmTransaction(connection, signature);
    return signature;
  }

  const provider = getLegacySolanaProvider(walletName);
  if (provider?.signTransaction) {
    const signed = await provider.signTransaction(tx);
    return sendSignedTransaction(connection, await signed.serialize(), cluster);
  }
  if (provider?.signAndSendTransaction) {
    if (cluster.id === "solana:localnet") throw new Error("This wallet only exposed sign-and-send. For Surfnet, use a wallet/account that supports signTransaction, or set the wallet's RPC/network to http://127.0.0.1:8899.");
    const result = await provider.signAndSendTransaction(tx);
    if (result?.signature) {
      await confirmTransaction(connection, result.signature);
      return result.signature;
    }
  }

  throw new Error("Connected wallet does not expose Solana transaction signing.");
}

export function encodeVectorAuthorization(identity: Uint8Array, signature: Uint8Array) {
  return `${bytesToBase64(identity)}.${bytesToBase64(signature)}`;
}

export function decodeVectorAuthorization(value: string) {
  const [identityBase64, signatureBase64] = value.split(".");
  if (!identityBase64 || !signatureBase64) throw new Error("Swap offer is missing Vector authorization data.");
  return {
    identity: base64ToBytes(identityBase64),
    signature: base64ToBytes(signatureBase64),
  };
}

async function getTokenAccountAmount(connection: Connection, tokenAccount: Address) {
  const account = await connection.getAccountInfo(tokenAccount);
  if (!account) {
    return 0n;
  }
  return getTokenDecoder().decode(account.data).amount;
}

async function getMintInfo(connection: Connection, mint: Address) {
  const account = await connection.getAccountInfo(mint);
  if (!account?.data) throw new Error(`Mint ${mint.toString()} was not found or has invalid data.`);
  return getMintDecoder().decode(account.data);
}

async function assertTokenAccountBalance(connection: Connection, tokenAccount: Address, requiredAmount: bigint, label: string, context: { owner: Address; mint: Address }) {
  const currentAmount = await getTokenAccountAmount(connection, tokenAccount);
  if (currentAmount >= requiredAmount) return;

  throw new Error(`${label} has insufficient funds. ATA ${tokenAccount.toString()} for owner ${context.owner.toString()} mint ${context.mint.toString()} has ${currentAmount.toString()} base units, needs ${requiredAmount.toString()}.`);
}

async function getAssociatedTokenAddress(mint: Address, owner: Address) {
  const [address] = await findAssociatedTokenPda({ owner: toKitAddress(owner), tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: toKitAddress(mint) });
  return new Address(address);
}

function createAssociatedTokenAccountIdempotentInstruction(payer: Address, associatedToken: Address, owner: Address, mint: Address) {
  return toWeb3Instruction(getCreateAssociatedTokenIdempotentInstruction({ payer: toTransactionSigner(payer), ata: toKitAddress(associatedToken), owner: toKitAddress(owner), mint: toKitAddress(mint) }));
}

function createTransferInstruction(source: Address, destination: Address, owner: Address, amount: bigint) {
  return toWeb3Instruction(getTransferInstruction({ source: toKitAddress(source), destination: toKitAddress(destination), authority: toTransactionSigner(owner), amount }));
}

function createSyncNativeInstruction(account: Address) {
  return toWeb3Instruction(getSyncNativeInstruction({ account: toKitAddress(account) }));
}

function createCloseTokenAccountInstruction(account: Address, destination: Address, owner: Address) {
  return toWeb3Instruction(getCloseAccountInstruction({ account: toKitAddress(account), destination: toKitAddress(destination), owner: toTransactionSigner(owner) }));
}

async function assertVectorProgramDeployed(connection: Connection, cluster: AppCluster) {
  const programAccount = await connection.getAccountInfo(VECTOR.programId);
  if (!programAccount?.executable) {
    if (cluster.id === "solana:localnet") throw new Error("Vector program is not available on this RPC. Restart Surfpool with: bun run surfnet");
    throw new Error(`Vector program ${VECTOR.programId.toString()} is not available on ${cluster.label}. Check that your RPC is pointed at mainnet and has the Vector program deployed.`);
  }
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

async function createSwapSetupInstructions(connection: Connection, makerAddress: Address, swap: Awaited<ReturnType<typeof resolveSwapAccounts>>) {
  const setupIxs = await createMissingAtaInstructions(connection, swap.takerAddress, [
    { ata: swap.makerSendDestination, owner: swap.takerAddress, mint: swap.makerSendMint },
    { ata: swap.takerSendSource, owner: swap.takerAddress, mint: swap.takerSendMint },
    { ata: swap.takerSendDestination, owner: makerAddress, mint: swap.takerSendMint },
  ]);
  setupIxs.push(...await createTakerWrapSolInstructions(connection, swap.takerAddress, swap.takerSendSource, swap.takerSendMint, swap.takerSendAmount));
  return setupIxs;
}

async function resolveSwapAccounts(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState | SwapOffer) {
  const makerSendMint = new Address(form.makerSendTokenAddress);
  const takerSendMint = new Address(form.takerSendTokenAddress);
  const takerAddress = new Address(form.takerAddress);
  const [makerVectorPda] = findVectorPda(identity);
  const makerSendMintInfo = await getMintInfo(connection, makerSendMint);
  const takerSendMintInfo = await getMintInfo(connection, takerSendMint);
  const makerSendAmount = parseTokenAmount(form.makerSendAmount, makerSendMintInfo.decimals);
  const takerSendAmount = parseTokenAmount(form.takerSendAmount, takerSendMintInfo.decimals);
  const makerSendSource = await getAssociatedTokenAddress(makerSendMint, makerVectorPda);
  const makerSendDestination = await getAssociatedTokenAddress(makerSendMint, takerAddress);
  const takerSendSource = await getAssociatedTokenAddress(takerSendMint, takerAddress);
  const takerSendDestination = await getAssociatedTokenAddress(takerSendMint, makerAddress);

  return {
    makerVectorPda,
    takerAddress,
    makerSendMint,
    takerSendMint,
    makerSendAmount,
    takerSendAmount,
    makerSendSource,
    makerSendDestination,
    takerSendSource,
    takerSendDestination,
  };
}

function parseTokenAmount(amount: string, decimals: number) {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid token amount: ${amount}`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error(`Amount ${amount} has more than ${decimals} decimals.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

function stringifyRpcError(error: unknown) {
  return JSON.stringify(error, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

function toKitAddress(address: Address): KitAddress {
  return address.toString() as KitAddress;
}

function toTransactionSigner(address: Address): TransactionSigner {
  return { address: toKitAddress(address), signTransactions: async () => { throw new Error("Wallet signing is handled by the connected wallet."); } };
}

function toWeb3Instruction(instruction: { programAddress: KitAddress; accounts?: readonly KitAccountMeta[]; data?: ReadonlyUint8Array }) {
  return new TransactionInstruction({
    programId: new Address(instruction.programAddress),
    keys: instruction.accounts?.map((account) => ({
      pubkey: new Address(account.address),
      isSigner: account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER,
      isWritable: account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER,
    })) ?? [],
    data: instruction.data ? Uint8Array.from(instruction.data) : undefined,
  });
}

async function confirmTransaction(connection: Connection, signature: TransactionSignature) {
  if (!signature || signature.length < 80) throw new Error("Wallet returned an invalid transaction signature.");

  const deadline = Date.now() + transactionConfirmationTimeoutMs;
  let lastRpcError: unknown;

  while (Date.now() < deadline) {
    try {
      const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = statuses.value[0];
      if (status?.err) throw new Error(`Transaction failed: ${stringifyRpcError(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized" || status?.confirmations === null) return;

      const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (transaction?.meta?.err) throw new Error(`Transaction failed: ${stringifyRpcError(transaction.meta.err)}`);
      if (transaction) return;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Transaction failed:")) throw error;
      lastRpcError = error;
    }

    await sleep(transactionConfirmationPollMs);
  }

  const suffix = lastRpcError instanceof Error ? ` Last RPC error: ${lastRpcError.message}` : "";
  throw new Error(`Transaction ${signature} was submitted, but this RPC did not return confirmed status before timing out. Check the signature in Solana Explorer or retry with a healthier RPC endpoint.${suffix}`);
}

async function sendSignedTransaction(connection: Connection, signedTransaction: Uint8Array, cluster: AppCluster) {
  const signature = await connection.sendRawTransaction(signedTransaction, {
    preflightCommitment: "confirmed",
    skipPreflight: cluster.id === "solana:localnet",
  });
  await confirmTransaction(connection, signature);
  return signature;
}

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
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
