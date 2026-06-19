import { Address, Connection } from "@solana/web3.js";
import { deterministicIdentity, findVectorPda } from "../src/lib/vector";

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
const makerTokenAmount = BigInt(process.env.SURFNET_MAKER_TOKEN_AMOUNT ?? "10000000000");
const takerTokenAmount = BigInt(process.env.SURFNET_TAKER_TOKEN_AMOUNT ?? "10000000000");
const solAirdropLamports = Number(process.env.SURFNET_SOL_AIRDROP_LAMPORTS ?? "10000000000");
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

if (caseFlags.length !== 1 || !makerAddressArg || !takerAddressArg) {
  throw new Error("Usage: bun run surfnet:fund --case-1|--case-2|--case-3 <maker-wallet-address> <taker-wallet-address>");
}

const connection = new Connection(rpcUrl, "confirmed");
const makerAddress = new Address(makerAddressArg);
const takerAddress = new Address(takerAddressArg);
const makerVectorIdentity = deterministicIdentity(makerAddress);
const [makerVectorPda] = findVectorPda(makerVectorIdentity);

await airdrop(connection, makerAddress, solAirdropLamports);
await airdrop(connection, takerAddress, solAirdropLamports);
if (makerTokenMint !== wrappedSolMint) {
  await setTokenAccount(makerVectorPda!, new Address(makerTokenMint), makerTokenAmount);
}
if (takerTokenMint !== wrappedSolMint) {
  await setTokenAccount(takerAddress, new Address(takerTokenMint), takerTokenAmount);
}

console.log("Funded Surfnet swap accounts.");
console.log(`Funding case: ${selectedCase}`);
console.log(`Maker wallet SOL: ${makerAddress.toString()}`);
console.log(`Taker wallet SOL: ${takerAddress.toString()}`);
if (makerTokenMint === wrappedSolMint) {
  console.log(`Maker sends SOL: native SOL was airdropped to ${makerAddress.toString()}`);
} else {
  console.log(`Maker Vector PDA ${makerTokenMint}: ${makerVectorPda!.toString()} amount ${makerTokenAmount.toString()}`);
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

async function setTokenAccount(owner: Address, mint: Address, amount: bigint) {
  await surfnetRpc("surfnet_setTokenAccount", [
    owner.toString(),
    mint.toString(),
    {
      amount: Number(amount),
      state: "initialized",
    },
    tokenProgram,
  ]);
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
