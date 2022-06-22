const commands = [
  ["init", require("./init")],
  ["migrate", require("./migrate")],
  ["backfill", require("./backfill")],
  ["renumber-migration", require("./renumberMigration")],
  ["set-project-slug", require("./setProjectSlug")],
  ["add-project", require("./addProject")],
  ["add-autoglyphs", require("./addAutoglyphs")],
  ["add-cryptoadz", require("./addCryptoadz")],
  ["add-token", require("./addToken")],
  ["add-bare-token", require("./addBareToken")],
  ["add-project-tokens", require("./addProjectTokens")],
  ["reingest-project", require("./reingestProject")],
  ["update-suspicious-tokens", require("./updateSuspiciousTokens")],
  ["prune-empty-traits", require("./pruneEmptyTraits")],
  ["dump-trait-ordering", require("./dumpTraitOrdering")],
  ["follow-live-mint", require("./followLiveMint")],
  ["ingest-images", require("./ingestImages")],
  ["generate-image", require("./generateImage")],
  ["token-feed-wss", require("./tokenFeedWss")],
  ["watch-cnf-queue", require("./watchCnfQueue")],
  ["watch-token-traits-queue", require("./watchTokenTraitsQueue")],
  ["deactivate-expired-orders", require("./deactivateExpiredOrders")],
  ["opensea", require("./opensea")],
  ["follow-chain", require("./followChain")],
  ["add-historical-blocks", require("./addHistoricalBlocks")],
  ["add-new-jobs", require("./addNewJobs")],
  ["autorestart", require("./autorestart")],
];

module.exports = commands;
