import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
