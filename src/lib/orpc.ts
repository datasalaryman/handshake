import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { appRouter } from "../swaps/orpcRouter";

const link = new RPCLink({
  url: typeof window === "undefined" ? "http://localhost:3000/api/rpc" : `${window.location.origin}/api/rpc`,
});

export const orpc: RouterClient<typeof appRouter> = createORPCClient(link);
