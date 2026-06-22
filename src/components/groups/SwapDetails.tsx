import { InfoRow } from "@/components/units/InfoRow";
import { ReadOnlyValue } from "@/components/units/ReadOnlyValue";
import { SwapSideCard } from "@/components/units/SwapSideCard";
import type { SwapOffer } from "@/orpc/schema";

export function SwapDetails({ offer }: { offer: SwapOffer | undefined }) {
  if (!offer) {
    return <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Loading swap details...</p>;
  }

  return (
    <div className="mt-5 grid gap-4">
      <InfoRow label="Maker address" value={offer.makerAddress} mono />
      <InfoRow label="Taker address" value={offer.takerAddress} mono />
      <SwapSideCard title="Maker sends">
        <ReadOnlyValue label="Token sent" value={offer.makerSendTokenAddress} mono />
        <ReadOnlyValue label="Amount" value={offer.makerSendAmount} />
      </SwapSideCard>
      <SwapSideCard title="Taker sends">
        <ReadOnlyValue label="Token sent" value={offer.takerSendTokenAddress} mono />
        <ReadOnlyValue label="Amount" value={offer.takerSendAmount} />
      </SwapSideCard>
      <SwapSideCard title="Swap details">
        <ReadOnlyValue label="Maker receives token" value={offer.takerSendTokenAddress} mono />
        <ReadOnlyValue label="Taker receives token" value={offer.makerSendTokenAddress} mono />
      </SwapSideCard>
    </div>
  );
}
