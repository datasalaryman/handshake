import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { Address, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

type Scheme = {
  programId: Address;
  signatureLen: number;
};

export const ED25519: Scheme = {
  programId: new Address(import.meta.env.VECTOR_PROGRAM ?? "vectorcLBXJ2TuoKuUygkEi6FWqvBnbHDEDWoYamfjV"),
  signatureLen: 64,
};

const VECTOR_PDA_SEED = new TextEncoder().encode("vector");
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const INITIALIZE_DISCRIMINATOR = 0;
const ADVANCE_DISCRIMINATOR = 1;
const PASSTHROUGH_DISCRIMINATOR = 4;

export function findVectorPda(scheme: Scheme, identity: Uint8Array): [Address, number] {
  return findProgramAddressSync([VECTOR_PDA_SEED, identity.length <= 32 ? identity : sha256(identity)], scheme.programId);
}

export function createInitializeEd25519(payer: Address, pubkey: Uint8Array): TransactionInstruction {
  const [vectorPda] = findVectorPda(ED25519, pubkey);
  const data = new Uint8Array(1 + pubkey.length);
  data[0] = INITIALIZE_DISCRIMINATOR;
  data.set(pubkey, 1);

  return new TransactionInstruction({
    programId: ED25519.programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: vectorPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function createAdvanceInstruction(scheme: Scheme, identity: Uint8Array, signature: Uint8Array): TransactionInstruction {
  const [vectorPda] = findVectorPda(scheme, identity);
  const data = new Uint8Array(1 + signature.length);
  data[0] = ADVANCE_DISCRIMINATOR;
  data.set(signature, 1);

  return new TransactionInstruction({
    programId: scheme.programId,
    keys: [
      { pubkey: vectorPda, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function createPassthroughInstruction(scheme: Scheme, identity: Uint8Array, subInstructions: TransactionInstruction[]): TransactionInstruction {
  if (subInstructions.length > 255) throw new Error("Too many Vector passthrough instructions.");
  const [vectorPda] = findVectorPda(scheme, identity);
  const keys: AccountMeta[] = [
    { pubkey: vectorPda, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
  ];
  let dataLen = 2;

  for (const ix of subInstructions) {
    keys.push({ pubkey: ix.programId, isSigner: false, isWritable: false });
    for (const meta of ix.keys) keys.push({ pubkey: meta.pubkey, isSigner: false, isWritable: meta.isWritable });
    dataLen += 3 + ix.data.length;
  }

  const data = new Uint8Array(dataLen);
  let offset = 0;
  data[offset++] = PASSTHROUGH_DISCRIMINATOR;
  data[offset++] = subInstructions.length;

  for (const ix of subInstructions) {
    if (ix.keys.length > 255) throw new Error("Vector passthrough instruction has too many accounts.");
    if (ix.data.length > 65535) throw new Error("Vector passthrough instruction data is too long.");
    data[offset++] = ix.keys.length;
    writeU16LE(data, ix.data.length, offset);
    offset += 2;
    data.set(ix.data, offset);
    offset += ix.data.length;
  }

  return new TransactionInstruction({ programId: scheme.programId, keys, data });
}

export function advanceVectorDigest(scheme: Scheme, nonce: Uint8Array, identity: Uint8Array, preInstructions: TransactionInstruction[], postInstructions: TransactionInstruction[], feePayer?: Address): Uint8Array {
  const placeholder = new Uint8Array(scheme.signatureLen);
  const advanceIx = createAdvanceInstruction(scheme, identity, placeholder);
  const allInstructions = [...preInstructions, advanceIx, ...postInstructions];
  const promoted = promoteToMessageFlags(allInstructions, feePayer);
  const buffer = constructInstructionsData(promoted);
  const targetIndex = preInstructions.length;
  writeU16LE(buffer, targetIndex, buffer.length - 2);
  const ixOffset = readU16LE(buffer, 2 + 2 * targetIndex);
  const numAccounts = readU16LE(buffer, ixOffset);
  const sigStart = ixOffset + 2 + 33 * numAccounts + 32 + 2 + 1;
  const sigEnd = sigStart + scheme.signatureLen;
  const pre = buffer.subarray(0, sigStart);
  const post = buffer.subarray(sigEnd);
  const payload = new Uint8Array(pre.length + nonce.length + identity.length + post.length);
  payload.set(pre, 0);
  payload.set(nonce, pre.length);
  payload.set(identity, pre.length + nonce.length);
  payload.set(post, pre.length + nonce.length + identity.length);

  return sha256(payload);
}

function promoteToMessageFlags(instructions: TransactionInstruction[], feePayer?: Address): TransactionInstruction[] {
  const flagMap = new Map<string, { isSigner: boolean; isWritable: boolean }>();
  if (feePayer) flagMap.set(feePayer.toString(), { isSigner: true, isWritable: true });

  for (const ix of instructions) {
    for (const meta of ix.keys) {
      const key = meta.pubkey.toString();
      const existing = flagMap.get(key);
      if (existing) {
        existing.isSigner ||= meta.isSigner;
        existing.isWritable ||= meta.isWritable;
      } else {
        flagMap.set(key, { isSigner: meta.isSigner, isWritable: meta.isWritable });
      }
    }
  }

  return instructions.map((ix) => new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((meta) => ({ pubkey: meta.pubkey, ...flagMap.get(meta.pubkey.toString())! })),
    data: ix.data,
  }));
}

function constructInstructionsData(instructions: TransactionInstruction[]): Uint8Array {
  let totalSize = 2 + 2 * instructions.length + 2;
  for (const ix of instructions) totalSize += 2 + 33 * ix.keys.length + 32 + 2 + ix.data.length;

  const buffer = new Uint8Array(totalSize);
  let offset = 0;
  writeU16LE(buffer, instructions.length, offset);
  offset += 2;
  const offsetsStart = offset;
  offset += 2 * instructions.length;

  for (let i = 0; i < instructions.length; i++) {
    const ix = instructions[i]!;
    writeU16LE(buffer, offset, offsetsStart + 2 * i);
    writeU16LE(buffer, ix.keys.length, offset);
    offset += 2;
    for (const meta of ix.keys) {
      buffer[offset++] = (meta.isSigner ? 1 : 0) | (meta.isWritable ? 2 : 0);
      buffer.set(meta.pubkey.toBytes(), offset);
      offset += 32;
    }
    buffer.set(ix.programId.toBytes(), offset);
    offset += 32;
    writeU16LE(buffer, ix.data.length, offset);
    offset += 2;
    buffer.set(ix.data, offset);
    offset += ix.data.length;
  }

  writeU16LE(buffer, 0, offset);
  return buffer;
}

function findProgramAddressSync(seeds: Uint8Array[], programId: Address): [Address, number] {
  const programBytes = programId.toBytes();
  const totalLen = seeds.reduce((length, seed) => length + seed.length, 0) + 1 + programBytes.length + PDA_MARKER.length;
  const buffer = new Uint8Array(totalLen);
  let offset = 0;
  for (const seed of seeds) {
    buffer.set(seed, offset);
    offset += seed.length;
  }
  const bumpOffset = offset++;
  buffer.set(programBytes, offset);
  offset += programBytes.length;
  buffer.set(PDA_MARKER, offset);

  for (let bump = 255; bump >= 0; bump--) {
    buffer[bumpOffset] = bump;
    const hash = sha256(buffer);
    if (!isOnCurve(hash)) return [new Address(hash), bump];
  }

  throw new Error("Unable to find a viable Vector PDA bump seed.");
}

function isOnCurve(point: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(point);
    return true;
  } catch {
    return false;
  }
}

function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

function writeU16LE(buffer: Uint8Array, value: number, offset: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

function readU16LE(buffer: Uint8Array, offset: number) {
  return (buffer[offset] ?? 0) | ((buffer[offset + 1] ?? 0) << 8);
}
