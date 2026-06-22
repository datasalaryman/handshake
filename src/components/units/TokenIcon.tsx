import type { TokenSearchResult } from "@/lib/wallet-types";

export function TokenIcon({ token, compact }: { token: TokenSearchResult; compact?: boolean }) {
  const sizeClassName = compact ? "size-6" : "size-10";

  if (token.icon) {
    return <img alt="" className={`${sizeClassName} rounded-full bg-white/10 object-cover`} src={token.icon} />;
  }

  return <span className={`${sizeClassName} flex items-center justify-center rounded-full bg-violet-200 text-xs font-semibold text-slate-950`}>{token.symbol.slice(0, 2).toUpperCase()}</span>;
}
