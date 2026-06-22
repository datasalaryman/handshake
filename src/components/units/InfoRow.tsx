export function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className={`mt-2 break-all ${mono ? "font-mono text-sm" : "text-base"} text-slate-100`}>{value}</p>
    </div>
  );
}
