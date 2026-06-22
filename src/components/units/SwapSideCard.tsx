import type { ReactNode } from "react";

export function SwapSideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[0.7fr_1fr]">{children}</div>
    </section>
  );
}
