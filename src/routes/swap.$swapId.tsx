import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { TakerPanel } from "@/components/groups/TakerPanel";
import { SolanaProvider } from "@/components/providers/SolanaProvider";

export const Route = createFileRoute("/swap/$swapId")({
  component: SwapPage,
});

function SwapPage() {
  const { swapId } = Route.useParams();

  return (
    <main className="min-h-screen bg-[#06070d] px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl items-center justify-center">
        <ClientOnly fallback={<TakerPanelSkeleton />}>
          <SolanaProvider>
            <TakerPanel swapId={swapId} />
          </SolanaProvider>
        </ClientOnly>
      </section>
    </main>
  );
}

function TakerPanelSkeleton() {
  return <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-slate-300">Loading swap UI...</div>;
}
