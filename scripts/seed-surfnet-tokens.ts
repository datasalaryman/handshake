import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  Address,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ED25519, findVectorPda } from "../src/lib/vector";

const rpcUrl = process.env.SURFNET_RPC_URL ?? process.env.BUN_PUBLIC_SOLANA_LOCALNET_RPC_URL ?? "http://127.0.0.1:8899";
const keypairPath = expandPath(process.env.SOLANA_KEYPAIR ?? "~/.config/solana/id.json");
const makerAddressArg = process.argv[2];
const takerAddressArg = process.argv[3];

installWeb3AddressShims();

if (!makerAddressArg || !takerAddressArg) {
  throw new Error("Usage: bun run surfnet:seed <maker-wallet-address> <taker-wallet-address>");
}

if (!existsSync(keypairPath)) {
  throw new Error(`Payer keypair not found: ${keypairPath}. Set SOLANA_KEYPAIR to a funded local keypair.`);
}

const connection = new Connection(rpcUrl, "confirmed");
const payer = await readKeypair(keypairPath);
const makerAddress = new Address(makerAddressArg);
const takerAddress = new Address(takerAddressArg);
const [makerVectorPda] = findVectorPda(ED25519, makerAddress.toBytes());
const mintA = await Keypair.generate();
const mintB = await Keypair.generate();
const payerAddress = toAddress(payer.address);
const mintAAddress = toAddress(mintA.address);
const mintBAddress = toAddress(mintB.address);
const makerTokenA = getAssociatedTokenAddressSync(mintAAddress as never, makerVectorPda as never, true, TOKEN_PROGRAM_ID as never, ASSOCIATED_TOKEN_PROGRAM_ID as never);
const takerTokenA = getAssociatedTokenAddressSync(mintAAddress as never, takerAddress as never, false, TOKEN_PROGRAM_ID as never, ASSOCIATED_TOKEN_PROGRAM_ID as never);
const makerTokenB = getAssociatedTokenAddressSync(mintBAddress as never, makerVectorPda as never, true, TOKEN_PROGRAM_ID as never, ASSOCIATED_TOKEN_PROGRAM_ID as never);
const takerTokenB = getAssociatedTokenAddressSync(mintBAddress as never, takerAddress as never, false, TOKEN_PROGRAM_ID as never, ASSOCIATED_TOKEN_PROGRAM_ID as never);
const rentExemptMintLamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

await airdrop(connection, payerAddress);
await airdrop(connection, makerAddress);
await airdrop(connection, takerAddress);

const tx = new Transaction({ ...(await connection.getLatestBlockhash()), feePayer: payerAddress as never }).add(
  SystemProgram.createAccount({
    fromPubkey: payerAddress as never,
    newAccountPubkey: mintAAddress as never,
    lamports: rentExemptMintLamports,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID as never,
  }),
  createInitializeMint2Instruction(mintAAddress as never, 6, payerAddress as never, null),
  SystemProgram.createAccount({
    fromPubkey: payerAddress as never,
    newAccountPubkey: mintBAddress as never,
    lamports: rentExemptMintLamports,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID as never,
  }),
  createInitializeMint2Instruction(mintBAddress as never, 6, payerAddress as never, null),
  createAssociatedTokenAccountInstruction(payerAddress as never, makerTokenA as never, makerVectorPda as never, mintAAddress as never),
  createAssociatedTokenAccountInstruction(payerAddress as never, takerTokenA as never, takerAddress as never, mintAAddress as never),
  createAssociatedTokenAccountInstruction(payerAddress as never, makerTokenB as never, makerVectorPda as never, mintBAddress as never),
  createAssociatedTokenAccountInstruction(payerAddress as never, takerTokenB as never, takerAddress as never, mintBAddress as never),
  createMintToInstruction(mintAAddress as never, makerTokenA as never, payerAddress as never, 1_000_000_000n),
  createMintToInstruction(mintBAddress as never, takerTokenB as never, payerAddress as never, 1_000_000_000n),
);

await sendTransaction(connection, tx, [payer, mintA, mintB]);

const envFile = ".surfpool/local-token-env.sh";
const envContents = [
  `export BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_ADDRESS=${mintAAddress.toString()}`,
  "export BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_NAME='Local Token A'",
  "export BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_SYMBOL=LTA",
  "export BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_DECIMALS=6",
  `export BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_ADDRESS=${mintBAddress.toString()}`,
  "export BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_NAME='Local Token B'",
  "export BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_SYMBOL=LTB",
  "export BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_DECIMALS=6",
  "",
].join("\n");

await Bun.$`mkdir -p .surfpool`;
await Bun.write(envFile, envContents);

console.log("Surfnet swap tokens seeded.");
console.log(`Maker Vector PDA: ${makerVectorPda.toString()}`);
console.log(`Maker token A source: ${makerTokenA.toString()}`);
console.log(`Taker token A destination: ${takerTokenA.toString()}`);
console.log(`Taker token B source: ${takerTokenB.toString()}`);
console.log(`Maker token B destination: ${makerTokenB.toString()}`);
console.log("");
console.log(`Wrote app token env to ${envFile}.`);
console.log("Start the app with these env vars:");
console.log(`BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_ADDRESS=${mintAAddress.toString()}`);
console.log("BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_NAME=Local Token A");
console.log("BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_SYMBOL=LTA");
console.log("BUN_PUBLIC_DEFAULT_MAKER_SEND_TOKEN_DECIMALS=6");
console.log(`BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_ADDRESS=${mintBAddress.toString()}`);
console.log("BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_NAME=Local Token B");
console.log("BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_SYMBOL=LTB");
console.log("BUN_PUBLIC_DEFAULT_TAKER_SEND_TOKEN_DECIMALS=6");

async function readKeypair(path: string) {
  const secret = await Bun.file(path).json();
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function airdrop(connection: Connection, address: Address) {
  const signature = await connection.requestAirdrop(address, 10_000_000_000);
  await connection.confirmTransaction(signature, "confirmed");
}

async function sendTransaction(connection: Connection, tx: Transaction, signers: Parameters<Transaction["sign"]>) {
  await tx.sign(...signers);
  const signature = await connection.sendRawTransaction(await tx.serialize());
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

function toAddress(value: Address | string | { toString(): string }) {
  return value instanceof Address ? value : new Address(value.toString());
}

function expandPath(path: string) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function installWeb3AddressShims() {
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
