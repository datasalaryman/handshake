import {
  findAssociatedTokenPda,
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

export async function ensureVectorAccountInitialized(connection: Connection, makerAddress: Address, vectorKeypair: VectorKeypair, identity: Uint8Array, walletName: string | undefined, cluster: AppCluster, setStatus: (status: string) => void) {
  await assertVectorProgramDeployed(connection, cluster);
  const [makerVectorPda] = findVectorPda(identity);
  const existingVectorAccount = await connection.getAccountInfo(makerVectorPda);
  if (existingVectorAccount) return undefined;

  setStatus("Initializing maker Vector account...");
  const rentTopUpLamports = Number(await connection.getMinimumBalanceForRentExemption(33 + VECTOR.storedIdentityLen));
  const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: makerAddress }).add(
    createInitializeInstruction(makerAddress, vectorKeypair.publicKey),
    SystemProgram.transfer({ fromPubkey: makerAddress, toPubkey: makerVectorPda, lamports: rentTopUpLamports }),
  );
  await simulateTransaction(connection, tx);
  const signature = await signAndSendWalletTransaction(walletName, tx, cluster, connection);
  await confirmTransaction(connection, signature);
  return signature;
}

export async function wrapMakerSolIfNeeded(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState, walletName: string | undefined, cluster: AppCluster, setStatus: (status: string) => void) {
  if (form.makerSendTokenAddress !== wrappedSolMintAddress) return undefined;

  const makerSendMint = new Address(form.makerSendTokenAddress);
  const makerSendMintInfo = await getMintInfo(connection, makerSendMint);
  const requiredAmount = parseTokenAmount(form.makerSendAmount, makerSendMintInfo.decimals);
  const [makerVectorPda] = findVectorPda(identity);
  const makerSendSource = await getAssociatedTokenAddress(makerSendMint, makerVectorPda);
  const existingAmount = await getTokenAccountAmount(connection, makerSendSource);
  const missingAmount = requiredAmount - existingAmount;
  if (missingAmount <= 0n) return undefined;
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
  return signature;
}

export async function buildSwapAuthorization(connection: Connection, makerAddress: Address, identity: Uint8Array, form: SwapFormState | SwapOffer) {
  const makerSendMint = new Address(form.makerSendTokenAddress);
  const takerSendMint = new Address(form.takerSendTokenAddress);
  const takerAddress = new Address(form.takerAddress);
  const [makerVectorPda] = findVectorPda(identity);
  const vectorAccount = await connection.getAccountInfo(makerVectorPda);
  if (!vectorAccount?.data || vectorAccount.data.length < 33) throw new Error("Maker Vector account is not initialized on this cluster.");

  const makerSendMintInfo = await getMintInfo(connection, makerSendMint);
  const takerSendMintInfo = await getMintInfo(connection, takerSendMint);
  const makerSendAmount = parseTokenAmount(form.makerSendAmount, makerSendMintInfo.decimals);
  const takerSendAmount = parseTokenAmount(form.takerSendAmount, takerSendMintInfo.decimals);
  const makerSendSource = await getAssociatedTokenAddress(makerSendMint, makerVectorPda);
  const makerSendDestination = await getAssociatedTokenAddress(makerSendMint, takerAddress);
  const takerSendSource = await getAssociatedTokenAddress(takerSendMint, takerAddress);
  const takerSendDestination = await getAssociatedTokenAddress(takerSendMint, makerAddress);
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
  if (!signature || signature.length < 80) return;
  const blockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
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
