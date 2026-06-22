export type SwapFormState = {
  makerSendTokenAddress: string;
  makerSendAmount: string;
  takerAddress: string;
  takerSendTokenAddress: string;
  takerSendAmount: string;
};

export type TokenSearchResult = {
  address: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  isVerified: boolean;
  organicScore?: number;
  organicScoreLabel?: "high" | "medium" | "low";
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  isSus: boolean;
};
