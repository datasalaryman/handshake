import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { swapOffers, type SwapOfferRow } from "./schema";

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

export type CreateSwapOfferInput = Omit<SwapOffer, "id" | "status" | "createdAt" | "submittedSignature">;

export type MarkSwapSubmittedInput = {
  id: string;
  submittedSignature: string;
};

export async function createSwapOffer(input: CreateSwapOfferInput) {
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
    status: "maker_signed",
  }).returning();

  return mapSwapOffer(rows[0]);
}

export async function getSwapOffer(id: string) {
  const rows = await getDb().select().from(swapOffers).where(eq(swapOffers.id, id)).limit(1);
  return mapSwapOffer(rows[0]);
}

export async function markSwapSubmitted(input: MarkSwapSubmittedInput) {
  const rows = await getDb().update(swapOffers).set({
    status: "submitted",
    submittedSignature: input.submittedSignature,
  }).where(eq(swapOffers.id, input.id)).returning();

  return mapSwapOffer(rows[0]);
}

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
    status: row.status as SwapStatus,
    createdAt: row.createdAt.toISOString(),
    submittedSignature: row.submittedSignature ?? undefined,
  };
}
