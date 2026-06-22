import { ChevronDown } from "lucide-react";
import { TokenIcon } from "@/components/units/TokenIcon";
import type { TokenSearchResult } from "@/lib/wallet-types";

export function TokenPickerButton({ token, tokenAddress, placeholder, onClick }: { token: TokenSearchResult | undefined; tokenAddress: string; placeholder: string; onClick: () => void }) {
  return (
    <div>
      <button className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-left outline-none transition hover:border-violet-300/50 hover:bg-white/[0.1] focus:border-violet-300/60" type="button" onClick={onClick}>
        {token ? (
          <span className="flex min-w-0 items-center gap-2">
            <TokenIcon token={token} compact />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">{token.symbol}</span>
            </span>
          </span>
        ) : tokenAddress ? (
          <span className="min-w-0">
            <span className="block truncate font-mono text-xs text-white">{abbreviateAddress(tokenAddress)}</span>
          </span>
        ) : (
          <span className="text-sm font-semibold text-slate-200">{placeholder}</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-slate-400" />
      </button>
    </div>
  );
}

function abbreviateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
