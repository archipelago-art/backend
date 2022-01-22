const { withPool } = require("../db/util");
const tokenTransfers = require("../eth/tokenTransfers");

async function alchemyUndeferTransfers(args) {
  if (args.length !== 0) {
    throw new Error("usage: alchemy-undefer-transfers");
  }
  await withPool(async (pool) => {
    await tokenTransfers.undeferTransfers({ pool });
  });
}

module.exports = alchemyUndeferTransfers;
