import { os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { swapOffers, tokenSearchResultSchema, type SwapOffer, type SwapOfferRow, type SwapStatus } from "@/orpc/schema";

const nonEmptyString = z.string().trim().min(1);

const markSwapSubmittedInput = z.object({
  id: nonEmptyString,
  submittedSignature: nonEmptyString,
});

export const swapOffersRouter = {
  create: os
    .input(z.object({
      clusterId: nonEmptyString,
      makerAddress: nonEmptyString,
      makerSendTokenAddress: nonEmptyString,
      makerSendAmount: nonEmptyString,
      takerAddress: nonEmptyString,
      takerSendTokenAddress: nonEmptyString,
      takerSendAmount: nonEmptyString,
      vectorSignature: nonEmptyString,
      makerProofSignature: z.string().trim().optional(),
    }))
    .handler(async ({ input }) => {
      const rows = await getDb().insert(swapOffers).values({
        id: crypto.randomUUID(),
        clusterId: input.clusterId,
        makerAddress: input.makerAddress,
        makerSendTokenAddress: input.makerSendTokenAddress,
        makerSendAmount: input.makerSendAmount,
        takerAddress: input.takerAddress,
        takerSendTokenAddress: input.takerSendTokenAddress,
        takerSendAmount: input.takerSendAmount,
        vectorSignature: input.vectorSignature,
        makerProofSignature: input.makerProofSignature,
        status: "maker_signed",
      }).returning();

      return mapSwapOffer(rows[0]);
    }),
  get: os.input(z.object({ id: nonEmptyString })).handler(async ({ input }) => {
    const rows = await getDb().select().from(swapOffers).where(eq(swapOffers.id, input.id)).limit(1);
    return mapSwapOffer(rows[0]);
  }),
  markSubmitted: os.input(markSwapSubmittedInput).handler(async ({ input }) => {
    const rows = await getDb().update(swapOffers).set({
      status: "submitted",
      submittedSignature: input.submittedSignature,
    }).where(eq(swapOffers.id, input.id)).returning();

    return mapSwapOffer(rows[0]);
  }),
};

export const tokensRouter = {
  search: os.input(z.object({ query: z.string().trim().max(120) })).handler(async ({ input }) => {
    const apiToken = process.env.JUPITER_API_TOKEN;
    if (!apiToken) throw new Error("Set JUPITER_API_TOKEN to search Jupiter tokens.");

    const trimmedQuery = input.query.trim();
    if (!trimmedQuery) return [];

    const url = new URL("https://api.jup.ag/tokens/v2/search");
    url.searchParams.set("query", trimmedQuery);

    const response = await fetch(url, {
      headers: {
        "x-api-key": apiToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Jupiter token search failed: ${response.status} ${response.statusText}`);
    }

    const tokens = z.array(tokenSearchResultSchema).parse(await response.json());
    return tokens.filter((token) => !token.isSus);
  }),
};

export const appRouter = {
  swapOffers: swapOffersRouter,
  tokens: tokensRouter,
};

function mapSwapOffer(row: SwapOfferRow | undefined): SwapOffer {
  if (!row) throw new Error("Swap offer was not found.");

  return {
    id: row.id,
    clusterId: row.clusterId,
    makerAddress: row.makerAddress,
    makerSendTokenAddress: row.makerSendTokenAddress,
    makerSendAmount: row.makerSendAmount,
    takerAddress: row.takerAddress,
    takerSendTokenAddress: row.takerSendTokenAddress,
    takerSendAmount: row.takerSendAmount,
    vectorSignature: row.vectorSignature,
    makerProofSignature: row.makerProofSignature ?? undefined,
    status: row.status as SwapStatus,
    createdAt: row.createdAt.toISOString(),
    submittedSignature: row.submittedSignature ?? undefined,
  };
}
