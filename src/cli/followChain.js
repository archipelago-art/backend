const { withPool } = require("../db/util");
const main = require("../eth/chain");

async function followChain(args) {
  if (args.length !== 0) {
    throw new Error("usage: follow-chain");
  }
  await withPool(async (pool) => {
    await main({ pool });
  });
}

module.exports = followChain;
