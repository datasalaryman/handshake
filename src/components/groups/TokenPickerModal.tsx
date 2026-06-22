import { useDeferredValue, useEffect, useState } from "react";
import { TokenIcon } from "@/components/units/TokenIcon";
import { orpc } from "@/lib/orpc";
import type { TokenSearchResult } from "@/lib/wallet-types";

export function TokenPickerModal({ selectedToken, title, onClose, onSelect }: { selectedToken: TokenSearchResult | undefined; title: string; onClose: () => void; onSelect: (token: TokenSearchResult) => void }) {
  const [query, setQuery] = useState(selectedToken?.symbol ?? selectedToken?.address ?? "SOL");
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<TokenSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    async function searchTokens() {
      try {
        const tokens = await orpc.tokens.search({ query: trimmedQuery });
        if (!cancelled) setResults(tokens as TokenSearchResult[]);
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not search tokens.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timeout = window.setTimeout(searchTokens, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [deferredQuery]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="token-picker-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0b0d16] shadow-2xl shadow-black/50" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <h3 className="text-lg font-semibold text-white" id="token-picker-title">{title}</h3>
          <button className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="p-5">
          <label className="grid gap-2 text-sm text-slate-200" htmlFor="token-search">
            Search by token name, symbol, or address
            <input
              autoFocus
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-violet-300/60"
              id="token-search"
              placeholder="SOL, USDC, Jupiter, or mint address"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="mt-4 max-h-[420px] overflow-y-auto pr-1">
            {loading ? <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Searching Jupiter tokens...</p> : null}
            {error ? <p className="rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{error}</p> : null}
            {!loading && !error && results.length === 0 ? <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">No tokens found.</p> : null}
            <div className="grid gap-2">
              {results.map((token) => (
                <button className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-violet-300/50 hover:bg-white/[0.08]" key={token.address} type="button" onClick={() => onSelect(token)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <TokenIcon token={token} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold text-white">{token.symbol}</span>
                        {token.isVerified ? <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">Verified</span> : null}
                      </span>
                      <span className="block truncate text-sm text-slate-300">{token.name}</span>
                      <span className="block truncate font-mono text-xs text-slate-500">{abbreviateAddress(token.address)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-400">
                    {token.usdPrice ? <span className="block text-slate-200">{formatUsd(token.usdPrice)}</span> : null}
                    {token.organicScoreLabel ? <span className="block capitalize">{token.organicScoreLabel} score</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function abbreviateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatUsd(value: number) {
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString(undefined, { maximumSignificantDigits: 3 })}`;
}
