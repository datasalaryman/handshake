export function ReadOnlyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-2 break-all ${mono ? "font-mono text-sm" : "text-base font-semibold"} text-white`}>{value}</p>
    </div>
  );
}
