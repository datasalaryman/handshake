import { Address, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { falcon512 as nobleFalcon } from "@noble/post-quantum/falcon.js";
import { advanceVectorDigest as sdkAdvanceVectorDigest } from "@/lib/vector-sdk/digest";
import {
  createAdvanceInstruction as sdkCreateAdvanceInstruction,
  createCloseSubinstruction as sdkCreateCloseSubinstruction,
  createInitializeInstruction as sdkCreateInitializeInstruction,
  createPassthroughInstruction as sdkCreatePassthroughInstruction,
} from "@/lib/vector-sdk/instructions";
import { findVectorPda as sdkFindVectorPda, type Scheme as SdkScheme } from "@/lib/vector-sdk/scheme";
import { FALCON_PUBKEY_LEN, FALCON_PREPARED_PUBKEY_LEN, FALCON_SIGNATURE_LEN, sha256 } from "@/lib/vector-sdk/scheme";

export type Scheme = {
  programId: Address;
  signatureLen: number;
  identityLen: number;
  storedIdentityLen: number;
};

const mainnetVectorProgram = "DzqGka5o9CjrTgP9QKUrXnxMxCLkWkTMiESuDqELgBwE";
const vectorProgram = import.meta.env.DEV ? import.meta.env.VECTOR_PROGRAM ?? mainnetVectorProgram : mainnetVectorProgram;

export const VECTOR: Scheme = {
  programId: new Address(vectorProgram),
  signatureLen: FALCON_SIGNATURE_LEN,
  identityLen: 32,
  storedIdentityLen: 32 + 1 + FALCON_PREPARED_PUBKEY_LEN,
};

export type VectorKeypair = {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
};

export type VectorSwapSeedConfig = {
  clusterId: string;
  makerSendTokenAddress: string;
  makerSendAmount: string;
  takerAddress: string;
  takerSendTokenAddress: string;
  takerSendAmount: string;
};

const textEncoder = new TextEncoder();
const deterministicSeedPrefix = textEncoder.encode("handshake:vector:falcon512:swap:v2");

export function createInitializeInstruction(payer: Address, publicKey: Uint8Array) {
  const identity = vectorIdentity(publicKey);
  return normalizeInstruction(sdkCreateInitializeInstruction(payer as never, toSdkScheme(VECTOR), identity, publicKey));
}

export function createKeypair(seed?: Uint8Array): VectorKeypair {
  const kp = seed ? nobleFalcon.keygen(seed) : nobleFalcon.keygen();
  return {
    secretKey: Uint8Array.from(kp.secretKey),
    publicKey: Uint8Array.from(kp.publicKey),
  };
}

export function createDeterministicKeypair(owner: Address, swap: VectorSwapSeedConfig): VectorKeypair {
  return createKeypair(deterministicSeed(owner, swap));
}

export function deterministicIdentity(owner: Address, swap: VectorSwapSeedConfig): Uint8Array {
  return vectorIdentity(createDeterministicKeypair(owner, swap).publicKey);
}

function deterministicSeed(owner: Address, swap: VectorSwapSeedConfig): Uint8Array {
  const seedFields = JSON.stringify([
    ["makerAddress", owner.toString()],
    ["clusterId", swap.clusterId],
    ["makerSendTokenAddress", new Address(swap.makerSendTokenAddress).toString()],
    ["makerSendAmount", normalizeSwapSeedAmount(swap.makerSendAmount)],
    ["takerAddress", new Address(swap.takerAddress).toString()],
    ["takerSendTokenAddress", new Address(swap.takerSendTokenAddress).toString()],
    ["takerSendAmount", normalizeSwapSeedAmount(swap.takerSendAmount)],
  ]);
  const seedBytes = textEncoder.encode(seedFields);
  const seedMaterial = new Uint8Array(deterministicSeedPrefix.length + seedBytes.length + 1);
  seedMaterial.set(deterministicSeedPrefix, 0);
  seedMaterial.set(seedBytes, deterministicSeedPrefix.length);

  const seed = new Uint8Array(48);
  seed.set(sha256(seedMaterial), 0);
  seedMaterial[seedMaterial.length - 1] = 1;
  seed.set(sha256(seedMaterial).slice(0, 16), 32);
  return seed;
}

function normalizeSwapSeedAmount(amount: string) {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid swap seed amount: ${amount}`);
  const [wholePart = "0", fractionPart = ""] = trimmed.split(".");
  const whole = wholePart.replace(/^0+(?=\d)/, "");
  const fraction = fractionPart.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function vectorIdentity(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== FALCON_PUBKEY_LEN) {
    throw new Error(`Vector public key must be ${FALCON_PUBKEY_LEN} bytes, got ${publicKey.length}`);
  }
  return sha256(publicKey);
}

export function signAdvanceInstruction(keypair: VectorKeypair, nonce: Uint8Array, preInstructions: TransactionInstruction[], postInstructions: TransactionInstruction[], feePayer?: Address) {
  const identity = vectorIdentity(keypair.publicKey);
  const digest = advanceVectorDigest(nonce, identity, preInstructions, postInstructions, feePayer);
  const detached = Uint8Array.from(nobleFalcon.sign(digest, keypair.secretKey));
  if (detached.length > FALCON_SIGNATURE_LEN) {
    throw new Error(`Vector signature ${detached.length} B exceeds wire size ${FALCON_SIGNATURE_LEN}`);
  }

  const signature = new Uint8Array(FALCON_SIGNATURE_LEN);
  signature.set(detached, 0);
  return createAdvanceInstruction(identity, signature);
}

export function createAdvanceInstruction(identity: Uint8Array, signature: Uint8Array) {
  return normalizeInstruction(sdkCreateAdvanceInstruction(toSdkScheme(VECTOR), identity, signature));
}

export function createCloseSubinstruction(identity: Uint8Array, closeTo: Address) {
  return normalizeInstruction(sdkCreateCloseSubinstruction(toSdkScheme(VECTOR), identity, closeTo as never));
}

export function createPassthroughInstruction(identity: Uint8Array, subInstructions: TransactionInstruction[]) {
  return normalizeInstruction(sdkCreatePassthroughInstruction(toSdkScheme(VECTOR), identity, subInstructions as never));
}

export function advanceVectorDigest(nonce: Uint8Array, identity: Uint8Array, preInstructions: TransactionInstruction[], postInstructions: TransactionInstruction[], feePayer?: Address) {
  return sdkAdvanceVectorDigest(toSdkScheme(VECTOR), nonce, identity, preInstructions as never, postInstructions as never, feePayer as never);
}

export function findVectorPda(identity: Uint8Array): [Address, number] {
  const [pda, bump] = sdkFindVectorPda(toSdkScheme(VECTOR), identity);
  return [toLocalAddress(pda), bump];
}

function toSdkScheme(scheme: Scheme): SdkScheme {
  return scheme as unknown as SdkScheme;
}

function normalizeInstruction(ix: unknown) {
  const instruction = ix as TransactionInstruction;
  return new TransactionInstruction({
    programId: toLocalAddress(instruction.programId),
    keys: instruction.keys.map((meta) => ({ ...meta, pubkey: toLocalAddress(meta.pubkey) }) satisfies AccountMeta),
    data: instruction.data,
  });
}

function toLocalAddress(value: { toString(): string }) {
  return value instanceof Address ? value : new Address(value.toString());
}
