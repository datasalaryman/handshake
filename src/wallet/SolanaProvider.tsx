import { WalletUi, createWalletUiConfig } from "@wallet-ui/react";
import type { ReactNode } from "react";
import { appClusters } from "@/wallet/clusters";

const config = createWalletUiConfig({
  clusters: appClusters,
});

export function SolanaProvider({ children }: { children: ReactNode }) {
  return <WalletUi config={config}>{children}</WalletUi>;
}
