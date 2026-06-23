import { Address, Connection } from "@solana/web3.js";
import { findAssociatedTokenPda, getMintDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Address as KitAddress } from "@solana/kit";

const rpcUrl = process.env.SURFNET_RPC_URL ?? process.env.BUN_PUBLIC_SOLANA_LOCALNET_RPC_URL ?? "http://127.0.0.1:8899";
const args = process.argv.slice(2);
const caseFlags = args.filter((arg) => arg === "--case-1" || arg === "--case-2" || arg === "--case-3");
const selectedCase = caseFlags[0];
const walletArgs = args.filter((arg) => !arg.startsWith("--"));
const makerAddressArg = walletArgs[0];
const takerAddressArg = walletArgs[1];
const wrappedSolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const usdtMint = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const { makerTokenMint, takerTokenMint } = getTokenPair(selectedCase);
const makerSendAmount = process.env.SURFNET_MAKER_SEND_AMOUNT ?? "10";
const takerSendAmount = process.env.SURFNET_TAKER_SEND_AMOUNT ?? "10";
const solAirdropLamports = Number(process.env.SURFNET_SOL_AIRDROP_LAMPORTS ?? "10000000000");
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

if (caseFlags.length !== 1 || !makerAddressArg || !takerAddressArg) {
  throw new Error("Usage: bun run surfnet:fund --case-1|--case-2|--case-3 <maker-wallet-address> <taker-wallet-address>");
}

const connection = new Connection(rpcUrl, "confirmed");
const makerAddress = new Address(makerAddressArg);
const takerAddress = new Address(takerAddressArg);
const makerTokenAmount = await getFundingAmount(makerTokenMint, makerSendAmount, process.env.SURFNET_MAKER_TOKEN_AMOUNT);
const takerTokenAmount = await getFundingAmount(takerTokenMint, takerSendAmount, process.env.SURFNET_TAKER_TOKEN_AMOUNT);

await airdrop(connection, makerAddress, solAirdropLamports);
await airdrop(connection, takerAddress, solAirdropLamports);
for (const target of sourceTokenFundingTargets()) {
  const mint = new Address(target.mint);
  const tokenAccount = await getAssociatedTokenAddress(mint, target.owner);
  await setTokenAccount(target.owner, mint, target.amount);
  const fundedAmount = await getTokenAccountAmount(connection, tokenAccount);
  if (fundedAmount < target.amount) {
    throw new Error(`Funding verification failed for ${target.label} ATA ${tokenAccount.toString()}: expected at least ${target.amount.toString()}, got ${fundedAmount.toString()}`);
  }
  console.log(`Funded ${target.label} ATA ${tokenAccount.toString()} with ${fundedAmount.toString()} base units.`);
}

console.log("Funded Surfnet swap accounts.");
console.log(`Funding case: ${selectedCase}`);
console.log(`Swap seed amounts: maker ${makerSendAmount}, taker ${takerSendAmount}`);
console.log(`Maker wallet SOL: ${makerAddress.toString()}`);
console.log(`Taker wallet SOL: ${takerAddress.toString()}`);
if (makerTokenMint === wrappedSolMint) {
  console.log(`Maker sends SOL: native SOL was airdropped to ${makerAddress.toString()}`);
} else {
  console.log(`Maker wallet ${makerTokenMint}: ${makerAddress.toString()} amount ${makerTokenAmount.toString()}`);
}
if (takerTokenMint === wrappedSolMint) {
  console.log(`Taker sends SOL: native SOL was airdropped to ${takerAddress.toString()}`);
} else {
  console.log(`Taker wallet ${takerTokenMint}: ${takerAddress.toString()} amount ${takerTokenAmount.toString()}`);
}

async function airdrop(connection: Connection, address: Address, lamports: number) {
  const signature = await connection.requestAirdrop(address, lamports);
  await connection.confirmTransaction(signature, "confirmed");
}

function sourceTokenFundingTargets() {
  const targets: { label: string; owner: Address; mint: string; amount: bigint }[] = [];
  if (makerTokenMint !== wrappedSolMint) {
    targets.push({ label: "maker wallet source", owner: makerAddress, mint: makerTokenMint, amount: makerTokenAmount });
  }
  if (takerTokenMint !== wrappedSolMint) {
    targets.push({ label: "taker wallet source", owner: takerAddress, mint: takerTokenMint, amount: takerTokenAmount });
  }
  return targets;
}

function getTokenPair(selectedCase: string | undefined) {
  switch (selectedCase) {
    case "--case-1":
      return { makerTokenMint: wrappedSolMint, takerTokenMint: usdcMint };
    case "--case-2":
      return { makerTokenMint: usdcMint, takerTokenMint: wrappedSolMint };
    case "--case-3":
      return { makerTokenMint: usdcMint, takerTokenMint: usdtMint };
    default:
      return { makerTokenMint: wrappedSolMint, takerTokenMint: usdcMint };
  }
}

async function getFundingAmount(mint: string, humanAmount: string, baseUnitOverride: string | undefined) {
  if (baseUnitOverride) return BigInt(baseUnitOverride);
  const mintInfo = await getMintInfo(new Address(mint));
  return parseTokenAmount(humanAmount, mintInfo.decimals);
}

async function getMintInfo(mint: Address) {
  const account = await connection.getAccountInfo(mint);
  if (!account?.data) throw new Error(`Mint ${mint.toString()} was not found or has invalid data.`);
  return getMintDecoder().decode(account.data);
}

function parseTokenAmount(amount: string, decimals: number) {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid token amount: ${amount}`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error(`Amount ${amount} has more than ${decimals} decimals.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

async function setTokenAccount(owner: Address, mint: Address, amount: bigint) {
  const rpcAmount = Number(amount);
  if (!Number.isSafeInteger(rpcAmount)) {
    throw new Error(`Token amount ${amount.toString()} is too large to send to Surfnet as a JSON u64 number`);
  }

  await surfnetRpc("surfnet_setTokenAccount", [
    owner.toString(),
    mint.toString(),
    {
      amount: rpcAmount,
      state: "initialized",
    },
    tokenProgram,
  ]);
}

async function getAssociatedTokenAddress(mint: Address, owner: Address) {
  const [address] = await findAssociatedTokenPda({ owner: owner.toString() as KitAddress, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: mint.toString() as KitAddress });
  return new Address(address);
}

async function getTokenAccountAmount(connection: Connection, tokenAccount: Address) {
  const balance = await connection.getTokenAccountBalance(tokenAccount);
  return BigInt(balance.value.amount);
}

async function surfnetRpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error ?? payload)}`);
  }
  return payload.result;
}
