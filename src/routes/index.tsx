import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { MakerPanel } from "@/components/groups/MakerPanel";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="min-h-screen bg-[#06070d] px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl items-center justify-center">
        <ClientOnly fallback={<MakerPanelSkeleton />}>
          <MakerPanel />
        </ClientOnly>
      </section>
    </main>
  );
}

function MakerPanelSkeleton() {
  return <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-slate-300">Loading wallet UI...</div>;
}
