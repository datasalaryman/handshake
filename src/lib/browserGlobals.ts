import { Buffer } from "buffer";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Address, PublicKey } from "@solana/web3.js";

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}

globalThis.Buffer ??= Buffer;

installWeb3V3CompatibilityShims();

function installWeb3V3CompatibilityShims() {
  const addressPrototype = Address.prototype as unknown as { toBuffer?: () => Buffer };
  if (!addressPrototype.toBuffer) {
    addressPrototype.toBuffer = function (this: Address) {
      return Buffer.from(this.toBytes());
    };
  }

  const publicKeyClass = PublicKey as unknown as {
    findProgramAddressSync?: (seeds: Uint8Array[], programId: Address) => [Address, number];
  };
  if (!publicKeyClass.findProgramAddressSync) {
    publicKeyClass.findProgramAddressSync = findProgramAddressSync;
  }
}

function findProgramAddressSync(seeds: Uint8Array[], programId: Address): [Address, number] {
  const marker = new TextEncoder().encode("ProgramDerivedAddress");
  const programBytes = programId.toBytes();
  const buffer = new Uint8Array(seeds.reduce((length, seed) => length + seed.length, 0) + 1 + programBytes.length + marker.length);
  let offset = 0;
  for (const seed of seeds) {
    buffer.set(seed, offset);
    offset += seed.length;
  }
  const bumpOffset = offset++;
  buffer.set(programBytes, offset);
  offset += programBytes.length;
  buffer.set(marker, offset);

  for (let bump = 255; bump >= 0; bump--) {
    buffer[bumpOffset] = bump;
    const hash = sha256(buffer);
    if (!isOnCurve(hash)) return [new Address(hash), bump];
  }

  throw new Error("Unable to find a viable PDA bump seed.");
}

function isOnCurve(point: Uint8Array) {
  try {
    ed25519.Point.fromBytes(point);
    return true;
  } catch {
    return false;
  }
}
