import { os } from "@orpc/server";
import { z } from "zod";
import { searchJupiterTokens } from "../tokens/jupiter";
import { createSwapOffer, getSwapOffer, markSwapSubmitted } from "./swapServer";

const nonEmptyString = z.string().trim().min(1);

const createSwapOfferInput = z.object({
  clusterId: nonEmptyString,
  makerAddress: nonEmptyString,
  makerSendTokenAddress: nonEmptyString,
  makerSendAmount: nonEmptyString,
  takerAddress: nonEmptyString,
  takerSendTokenAddress: nonEmptyString,
  takerSendAmount: nonEmptyString,
  vectorSignature: nonEmptyString,
});

const markSwapSubmittedInput = z.object({
  id: nonEmptyString,
  submittedSignature: nonEmptyString,
});

export const swapOffersRouter = {
  create: os.input(createSwapOfferInput).handler(({ input }) => createSwapOffer(input)),
  get: os.input(z.object({ id: nonEmptyString })).handler(({ input }) => getSwapOffer(input.id)),
  markSubmitted: os.input(markSwapSubmittedInput).handler(({ input }) => markSwapSubmitted(input)),
};

export const tokensRouter = {
  search: os.input(z.object({ query: z.string().trim().max(120) })).handler(({ input }) => searchJupiterTokens(input.query)),
};

export const appRouter = {
  swapOffers: swapOffersRouter,
  tokens: tokensRouter,
};
