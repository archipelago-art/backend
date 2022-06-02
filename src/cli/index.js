const commands = [
  ["init", require("./init")],
  ["migrate", require("./migrate")],
  ["backfill", require("./backfill")],
  ["set-project-slug", require("./setProjectSlug")],
  ["add-project", require("./addProject")],
  ["add-autoglyphs", require("./addAutoglyphs")],
  ["add-cryptoadz", require("./addCryptoadz")],
  ["add-token", require("./addToken")],
  ["add-bare-token", require("./addBareToken")],
  ["add-project-tokens", require("./addProjectTokens")],
  ["reingest-project", require("./reingestProject")],
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
  ["watch-cnf-queue", require("./watchCnfQueue")],
  ["opensea", require("./opensea")],
  ["follow-chain", require("./followChain")],
  ["add-historical-blocks", require("./addHistoricalBlocks")],
  ["add-new-jobs", require("./addNewJobs")],
  ["autorestart", require("./autorestart")],
];

module.exports = commands;
