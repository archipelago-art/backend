const events = require("./events");

// Event payloads are JSON `{ projectId: string, tokenId: string, slug: string, tokenIndex: number }`.
const newTokens = events.channel("new_tokens");

// Event payloads are JSON `{ projectId: string, completedThroughTokenIndex: number }`.
const imageProgress = events.channel("image_progress");

// Event payloads are one of:
//
//  {
//    type: "ASK_PLACED",
//    orderId: string,
//    projectId: string,
//    tokenId: string,
//    slug: string,
//    tokenIndex: number,
//    venue: "ARCHIPELAGO" | "OPENSEA",
//    seller: address (0xstring),
//    currency: "ETH",
//    price: string(wei),
//    timestamp: string(iso8601),
//    expirationTime: null | string(iso8601),
//  }
//
// (other types of market events not yet implemented).
const marketEvents = events.channel("market_events");

// Event payloads are JSON `{ tokenContract: address, onChainTokenId: string }`.
const deferrals = events.channel("erc721_transfers_deferred");

module.exports = {
  newTokens,
  imageProgress,
  marketEvents,
  deferrals,
};
