const { withPool } = require("../db/util");
const tokenTransfers = require("../eth/tokenTransfers");

async function alchemyFollowTransfers(args) {
  if (args.length !== 0) {
    throw new Error("usage: alchemy-follow-transfers");
  }
  await withPool(async (pool) => {
    await tokenTransfers.ingestTransfersLive({ pool });
    // Keep the pool open forever.
    await new Promise(() => {});
  });
}

module.exports = alchemyFollowTransfers;
