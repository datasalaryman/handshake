import { z } from "zod";

const jupiterTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbol: z.string(),
  icon: z.string().nullable().optional(),
  decimals: z.number(),
  isVerified: z.boolean().nullable().optional(),
  organicScore: z.number().optional(),
  organicScoreLabel: z.enum(["high", "medium", "low"]).optional(),
  usdPrice: z.number().nullable().optional(),
  liquidity: z.number().nullable().optional(),
  mcap: z.number().nullable().optional(),
  audit: z.object({
    isSus: z.boolean().optional(),
  }).nullable().optional(),
});

export const tokenSearchResultSchema = jupiterTokenSchema.transform((token) => ({
  address: token.id,
  name: token.name,
  symbol: token.symbol,
  icon: token.icon ?? undefined,
  decimals: token.decimals,
  isVerified: token.isVerified ?? false,
  organicScore: token.organicScore,
  organicScoreLabel: token.organicScoreLabel,
  usdPrice: token.usdPrice ?? undefined,
  liquidity: token.liquidity ?? undefined,
  mcap: token.mcap ?? undefined,
  isSus: token.audit?.isSus ?? false,
}));

export type TokenSearchResult = z.infer<typeof tokenSearchResultSchema>;

export async function searchJupiterTokens(query: string) {
  const apiToken = process.env.JUPITER_API_TOKEN;
  if (!apiToken) throw new Error("Set JUPITER_API_TOKEN to search Jupiter tokens.");

  const trimmedQuery = query.trim();
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
}
