const { withClient } = require("../db/util");
const main = require("../eth/historicalBlocks");

async function addHistoricalBlocks(args) {
  if (args.length > 1) {
    throw new Error("usage: add-historical-blocks [START_BLOCK]");
  }
  const startBlockRaw = args[0] || "0";
  const startBlock = Number(startBlockRaw);
  if (!Number.isInteger(startBlock))
    throw new Error("invalid start block: " + startBlockRaw);
  await withClient(async (client) => {
    await main({ client, startBlock });
  });
}

module.exports = addHistoricalBlocks;
