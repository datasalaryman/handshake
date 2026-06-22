import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";

export const swapOffers = pgTable("handshake_swap_offers", {
  id: uuid("id").primaryKey(),
  clusterId: text("cluster_id").notNull(),
  makerAddress: text("maker_address").notNull(),
  makerSendTokenAddress: text("maker_send_token_address").notNull(),
  makerSendAmount: text("maker_send_amount").notNull(),
  takerAddress: text("taker_address").notNull(),
  takerSendTokenAddress: text("taker_send_token_address").notNull(),
  takerSendAmount: text("taker_send_amount").notNull(),
  vectorSignature: text("vector_signature").notNull(),
  status: text("status", { enum: ["maker_signed", "submitted"] }).notNull(),
  submittedSignature: text("submitted_signature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SwapOfferRow = typeof swapOffers.$inferSelect;

export type SwapStatus = "maker_signed" | "submitted";

export type SwapOffer = {
  id: string;
  clusterId: string;
  makerAddress: string;
  makerSendTokenAddress: string;
  makerSendAmount: string;
  takerAddress: string;
  takerSendTokenAddress: string;
  takerSendAmount: string;
  vectorSignature: string;
  status: SwapStatus;
  createdAt: string;
  submittedSignature?: string;
};

export const jupiterTokenSchema = z.object({
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
