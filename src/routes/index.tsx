import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { WalletPanel } from "../wallet/WalletPanel";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="min-h-screen bg-[#06070d] px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center">
        <div className="grid w-full gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-violet-100">
              TanStack Start + wallet-ui
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
                Connect a Solana wallet and read your SOL balance.
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                Choose localnet, devnet, or mainnet, connect a browser wallet extension, and see the selected public key and SOL amount.
              </p>
            </div>
          </div>

          <ClientOnly fallback={<WalletPanelSkeleton />}>
            <WalletPanel />
          </ClientOnly>
        </div>
      </section>
    </main>
  );
}

function WalletPanelSkeleton() {
  return <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-slate-300">Loading wallet UI...</div>;
}
