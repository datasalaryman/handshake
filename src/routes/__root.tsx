import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { SolanaProvider } from "@/components/providers/SolanaProvider";
import appCss from "@/index.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Handshake" },
      { name: "description", content: "Peer-to-peer token swaps on Solana" },
      { property: "og:title", content: "Handshake" },
      { property: "og:description", content: "Peer-to-peer token swaps on Solana" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Handshake" },
      { name: "twitter:description", content: "Peer-to-peer token swaps on Solana" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <QueryProvider>
        <SolanaProvider>
          <Outlet />
        </SolanaProvider>
      </QueryProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
