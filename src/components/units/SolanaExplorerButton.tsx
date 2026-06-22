import type { AppCluster } from "@/components/providers/SolanaProvider";

export function SolanaExplorerButton({ signature, cluster, label = "Explorer" }: { signature: string; cluster: AppCluster; label?: string }) {
  return (
    <a className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-semibold text-white transition hover:border-violet-200/40 hover:bg-white/10" href={getExplorerUrl(signature, cluster)} target="_blank" rel="noreferrer">
      <SolanaLogo />
      {label}
    </a>
  );
}

function getExplorerUrl(signature: string, cluster: AppCluster) {
  const url = new URL(`https://explorer.solana.com/tx/${signature}`);
  if (cluster.id === "solana:devnet") url.searchParams.set("cluster", "devnet");
  if (cluster.id === "solana:testnet") url.searchParams.set("cluster", "testnet");
  if (cluster.id === "solana:localnet") {
    url.searchParams.set("cluster", "custom");
    url.searchParams.set("customUrl", cluster.url.replace("127.0.0.1", "localhost"));
  }
  return url.toString();
}

function SolanaLogo() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 397 311" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h316.9c5.8 0 8.7 7 4.6 11.1l-62.6 62.6c-2.4 2.4-5.7 3.8-9.2 3.8H6.6c-5.8 0-8.7-7-4.6-11.1l62.6-62.6Z" fill="url(#solana-a)" />
      <path d="M64.6 3.8C67 .4 70.3-1 73.8-1h316.9c5.8 0 8.7 7 4.6 11.1l-62.6 62.6c-2.4 2.4-5.7 3.8-9.2 3.8H6.6c-5.8 0-8.7-7-4.6-11.1L64.6 3.8Z" fill="url(#solana-b)" />
      <path d="M332.7 120.2c-2.4-2.4-5.7-3.8-9.2-3.8H6.6c-5.8 0-8.7 7-4.6 11.1l62.6 62.6c2.4 2.4 5.7 3.8 9.2 3.8h316.9c5.8 0 8.7-7 4.6-11.1l-62.6-62.6Z" fill="url(#solana-c)" />
      <defs>
        <linearGradient id="solana-a" x1="360.9" y1="3" x2="141.2" y2="421.8" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3" /><stop offset="1" stopColor="#DC1FFF" /></linearGradient>
        <linearGradient id="solana-b" x1="264.8" y1="-47.5" x2="45.1" y2="371.3" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3" /><stop offset="1" stopColor="#DC1FFF" /></linearGradient>
        <linearGradient id="solana-c" x1="312.6" y1="-22.4" x2="92.9" y2="396.4" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3" /><stop offset="1" stopColor="#DC1FFF" /></linearGradient>
      </defs>
    </svg>
  );
}
