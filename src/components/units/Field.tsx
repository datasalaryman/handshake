export function Field({ label, value, onChange, inputMode, placeholder, hideLabel, error }: { label: string; value: string; onChange: (value: string) => void; inputMode?: "decimal"; placeholder?: string; hideLabel?: boolean; error?: string }) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <label className="grid gap-2 text-sm text-slate-200" htmlFor={id}>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
      <input
        className="h-full min-h-12 rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-300/60"
        id={id}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <span className="text-xs text-red-200" id={`${id}-error`}>{error}</span> : null}
    </label>
  );
}
