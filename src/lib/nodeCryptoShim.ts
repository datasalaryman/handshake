import { sha256 } from "@noble/hashes/sha2.js";

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  const chunks: Uint8Array[] = [];

  return {
    update(data: Uint8Array) {
      chunks.push(data);
      return this;
    },
    digest() {
      const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return sha256(bytes);
    },
  };
}
