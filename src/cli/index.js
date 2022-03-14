const commands = [
  ["init", require("./init")],
  ["migrate", require("./migrate")],
  ["backfill", require("./backfill")],
  ["add-project", require("./addProject")],
  ["add-autoglyphs", require("./addAutoglyphs")],
  ["add-token", require("./addToken")],
  ["add-project-tokens", require("./addProjectTokens")],
  ["follow-chain-tokens", require("./followChainTokens")],
  ["update-suspicious-tokens", require("./updateSuspiciousTokens")],
  ["prune-empty-traits", require("./pruneEmptyTraits")],
  ["dump-trait-ordering", require("./dumpTraitOrdering")],
  ["follow-live-mint", require("./followLiveMint")],
  ["ingest-images", require("./ingestImages")],
  ["generate-image", require("./generateImage")],
  ["token-feed-wss", require("./tokenFeedWss")],
  ["alchemy-follow-transfers", require("./alchemyFollowTransfers")],
  ["alchemy-poke-transfers", require("./alchemyPokeTransfers")],
  ["alchemy-undefer-transfers", require("./alchemyUndeferTransfers")],
  ["opensea", require("./opensea")],
];

module.exports = commands;
