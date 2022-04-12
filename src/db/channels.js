const events = require("./events");

// Event payloads are JSON `{ projectId: string, tokenId: string }`.
const newTokens = events.channel("new_tokens");

// Event payloads are JSON `{ projectId: string, completedThroughTokenIndex: number }`.
const imageProgress = events.channel("image_progress");

// Event payloads are JSON `{ tokenContract: address, onChainTokenId: string }`.
const deferrals = events.channel("erc721_transfers_deferred");

module.exports = {
  newTokens,
  imageProgress,
  deferrals,
};
