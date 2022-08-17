const events = require("./events");

// Event payloads are JSON `{ projectId: string, tokenId: string }`.
const newTokens = events.channel("new_tokens");

// Event payloads are JSON `{ projectId: string, completedThroughTokenIndex: number }`.
const imageProgress = events.channel("image_progress");

// Event payloads are JSON `{}` (empty object).
const traitsUpdated = events.channel("traits_updated");

// Event payloads are JSON `{ tokenContract: address, onChainTokenId: string }`.
const deferrals = events.channel("erc721_transfers_deferred");

// Event payloads are JSON values of the form:
//
//  {
//    messageId: string,
//    timestamp: string,
//    type: string,
//    topic: string,
//    data: JsonValue,
//  }
//
// where `messageId` is a standard-form UUID (hex digits and hyphens),
// `timestamp` is an ISO 8601 UTC timestamp, `type` is a screaming snake case
// constant like `"TOKEN_TRANSFERRED"`, `topic` is a string identifying which
// WebSocket consumers may be interested in the message, and `data` is an
// arbitrary JSON value whose schema depends on the value of `type`.
//
// Messages sent along this channel are forwarded verbatim by the API server to
// WebSocket clients (partitioned by `topic`), which may be developers
// consuming our API or end users on the frontend.
//
// Current types and their corresponding data schemata:
//
//  - For `type: "ASK_PLACED"`, `data` looks like:
//
//      {
//        askId: string,
//        projectId: string,
//        tokenId: string,
//        slug: string,
//        tokenIndex: number,
//        venue: "ARCHIPELAGO" | "OPENSEA",
//        seller: address (0xstring),
//        currency: "ETH",
//        price: string(wei),
//        timestamp: string(iso8601),
//        deadline: null | string(iso8601),
//      }
//
//  - For `type: "ASK_CANCELLED"`, `data` looks like:
//
//      {
//        askId: string,
//        projectId: string,
//        slug: string,
//        tokenIndex: number,
//      }
//
//  - For `type: "BID_PLACED"`, `data` looks like:
//
//      {
//        scope:
//          | { type: "TOKEN", tokenId: string, tokenIndex: number }
//          | { type: "PROJECT", projectId: string, slug: string }
//          | { type: "TRAIT", traitId: string, featureName: string, traitValue: string }
//          | { type: "CNF", cnfId: string }
//        bidId: string,
//        projectId: string,
//        slug: string,
//        venue: "ARCHIPELAGO" | "OPENSEA",
//        bidder: address (0xstring),
//        currency: "ETH",
//        price: string(wei),
//        timestamp: string(iso8601),
//        deadline: null | string(iso8601),
//      }
//
//  - For `type: "BID_CANCELLED"`, `data` looks like:
//
//      {
//        bidId: string,
//        projectId: string,
//        slug: string,
//      }
//
//  - For `type: "TOKEN_MINTED"`, `data` looks like:
//
//      {
//        projectId: string,
//        tokenId: string,
//        slug: string,
//        tokenIndex: number,
//        tokenContract: address,
//        onChainTokenId: number,
//      }
//
//  - For `type: "TRAITS_UPDATED"`, `data` looks like:
//
//      {
//        projectId: string,
//        tokenId: string,
//        slug: string,
//        tokenIndex: number,
//        traits: Array<{
//          featureId: string,
//          traitId: string,
//          featureName: string,
//          traitValue: string,
//          featureSlug: string,
//          traitSlug: string,
//        }>,
//      }
//
//  - For `type: "IMAGES_UPDATED"`, `data` looks like:
//
//      {
//        projectId: string,
//        tokenId: string,
//        slug: string,
//        tokenIndex: number,
//        tokenContract: address (0xstring),
//        onChainTokenId: string,
//      }
//
//  - For `type: "TOKEN_TRANSFERRED"`, `data` looks like:
//
//      {
//        slug: string,
//        tokenIndex: number,
//        blockTimestamp: string(iso8601),
//        tokenId: string,
//        fromAddress: address (0xstring),
//        toAddress: address (0xstring),
//        blockHash: string(bytes32),
//        blockNumber: number,
//        logIndex: number,
//        transactionHash: string(bytes32),
//      }
//
//  - For `type: "TOKEN_TRADED"`, `data` looks like:
//
//      {
//        slug: string,
//        buyer: address (0xstring),
//        seller: address (0xstring),
//        price: string(wei),
//        cost: string(wei),
//        tokenId: string,
//        tokenIndex: number,
//        tradeId: string,
//        currency: string,
//        logIndex: number,
//        proceeds: string(wei),
//        blockHash: string(bytes32),
//        blockNumber: number,
//        blockTimestamp: string(iso8601),
//        transactionHash: string(bytes32),
//      }
//
const websocketMessages = events.channel("websocket_messages");

module.exports = {
  newTokens,
  imageProgress,
  traitsUpdated,
  deferrals,
  websocketMessages,
};
