const events = require("./events");

// Event payloads are JSON `{ projectId: string, tokenId: string }`.
const newTokens = events.channel("new_tokens");

// Event payloads are JSON `{ projectId: string, completedThroughTokenIndex: number }`.
const imageProgress = events.channel("image_progress");

// Event payloads are JSON `{}` (empty object).
const traitsUpdated = events.channel("traits_updated");

// Event payloads are JSON `{ tokenContract: address, onChainTokenId: string }`.
const deferrals = events.channel("erc721_transfers_deferred");

// Event payloads are JSON `{ type: string, slug: string, ... }`, with
// type-specific fields.
//
// Current types:
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

//  {
//    type: "BID_PLACED",
//    scope:
//      | { type: "TOKEN", tokenId: string, tokenIndex: number }
//      | { type: "PROJECT", projectId: string, slug: string }
//      | { type: "TRAIT", traitId: string, featureName: string, traitValue: string }
//      | { type: "CNF", cnfId: string }
//    orderId: string,
//    projectId: string,
//    slug: string,
//    venue: "ARCHIPELAGO" | "OPENSEA",
//    bidder: address (0xstring),
//    currency: "ETH",
//    price: string(wei),
//    timestamp: string(iso8601),
//    expirationTime: null | string(iso8601),
//  }

//  {
//    type: "TOKEN_MINTED",
//    projectId: string,
//    tokenId: string,
//    slug: string,
//    tokenIndex: number,
//  }

//  {
//    type: "TOKEN_TRANSFERRED",
//    slug: string,
//    tokenIndex: number,
//    blockTimestamp: string(iso8601),
//    tokenId: string,
//    fromAddress: address (0xstring),
//    toAddress: address (0xstring),
//    blockHash: string(bytes32),
//    blockNumber: number,
//    logIndex: number,
//    transactionHash: string(bytes32),
//  }
//
// Messages sent along this channel are forwarded verbatim by the API server to
// WebSocket clients, which may be developers consuming our API or end users on
// the frontend.
const websocketMessages = events.channel("websocket_messages");

module.exports = {
  newTokens,
  imageProgress,
  traitsUpdated,
  deferrals,
  websocketMessages,
};
