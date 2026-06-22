export function ActionButton({ children, disabled, onClick }: { children: string; disabled: boolean; onClick: () => void }) {
  return (
    <button className="rounded-xl bg-violet-200 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  );
}
