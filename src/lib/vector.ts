import { Address, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { advanceVectorDigest as sdkAdvanceVectorDigest } from "./vector-sdk/digest";
import {
  createAdvanceInstruction as sdkCreateAdvanceInstruction,
  createCloseSubinstruction as sdkCreateCloseSubinstruction,
  createInitializeInstruction as sdkCreateInitializeInstruction,
  createPassthroughInstruction as sdkCreatePassthroughInstruction,
} from "./vector-sdk/instructions";
import { findVectorPda as sdkFindVectorPda, type Scheme as SdkScheme } from "./vector-sdk/scheme";

export type Scheme = {
  programId: Address;
  signatureLen: number;
  identityLen: number;
  storedIdentityLen: number;
};

export const ED25519: Scheme = {
  programId: new Address(import.meta.env.VECTOR_PROGRAM ?? "vectorcLBXJ2TuoKuUygkEi6FWqvBnbHDEDWoYamfjV"),
  signatureLen: 64,
  identityLen: 32,
  storedIdentityLen: 32,
};

export function createInitializeEd25519(payer: Address, pubkey: Uint8Array) {
  return normalizeInstruction(sdkCreateInitializeInstruction(payer as never, toSdkScheme(ED25519), pubkey, pubkey));
}

export function createAdvanceInstruction(scheme: Scheme, identity: Uint8Array, signature: Uint8Array) {
  return normalizeInstruction(sdkCreateAdvanceInstruction(toSdkScheme(scheme), identity, signature));
}

export function createCloseSubinstruction(scheme: Scheme, identity: Uint8Array, closeTo: Address) {
  return normalizeInstruction(sdkCreateCloseSubinstruction(toSdkScheme(scheme), identity, closeTo as never));
}

export function createPassthroughInstruction(scheme: Scheme, identity: Uint8Array, subInstructions: TransactionInstruction[]) {
  return normalizeInstruction(sdkCreatePassthroughInstruction(toSdkScheme(scheme), identity, subInstructions as never));
}

export function advanceVectorDigest(scheme: Scheme, nonce: Uint8Array, identity: Uint8Array, preInstructions: TransactionInstruction[], postInstructions: TransactionInstruction[], feePayer?: Address) {
  return sdkAdvanceVectorDigest(toSdkScheme(scheme), nonce, identity, preInstructions as never, postInstructions as never, feePayer as never);
}

export function findVectorPda(scheme: Scheme, identity: Uint8Array): [Address, number] {
  const [pda, bump] = sdkFindVectorPda(toSdkScheme(scheme), identity);
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
