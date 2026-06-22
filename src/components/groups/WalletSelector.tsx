import { WalletUiIcon, type UiWallet } from "@wallet-ui/react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { connectLegacyWallet, connectStandardWallet } from "@/lib/wallet-adapters";

export function WalletSelector({ wallets, onConnect, onError }: { wallets: UiWallet[]; onConnect: (walletName: string, address: string) => void; onError: (error: string | undefined) => void }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWalletName, setSelectedWalletName] = useState("");

  return (
    <Select disabled={isConnecting || !wallets.length} value={selectedWalletName} onValueChange={async (walletName) => {
      const wallet = wallets.find((walletOption) => walletOption.name === walletName);
      if (!wallet) return;

      setSelectedWalletName(walletName);
      onError(undefined);
      setIsConnecting(true);
      try {
        const address = wallet.features.includes("standard:connect") ? await connectStandardWallet(wallet) : await connectLegacyWallet(wallet);
        onConnect(wallet.name, address);
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not connect wallet.");
        setSelectedWalletName("");
      } finally {
        setIsConnecting(false);
      }
    }}>
      <SelectTrigger className="h-auto rounded-xl border-white/10 bg-white px-4 py-2 text-sm font-semibold text-slate-950 shadow-none transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-70">
        <SelectValue placeholder={isConnecting ? "Connecting..." : wallets.length ? "Select wallet" : "No wallets"} />
      </SelectTrigger>
      <SelectContent className="border-white/10 bg-slate-950 text-white">
        {wallets.map((wallet) => (
          <SelectItem className="focus:bg-white/10 focus:text-white" key={wallet.name} value={wallet.name}>
            <span className="flex items-center gap-2">
              <WalletUiIcon className="size-5 rounded-full" wallet={wallet} />
              <span>{wallet.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
