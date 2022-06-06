const { withPool } = require("../db/util");
const main = require("../eth/chain");

const USAGE = "usage: follow-chain [--new-blocks-batch-size BLOCKS]";

async function followChain(args) {
  let newBlocksBatchSize = null;
  while (args.length > 0) {
    let arg = args.shift();
    switch (arg) {
      case "--new-blocks-batch-size": {
        const rawValue = args.shift();
        if (rawValue == null) throw new Error(USAGE);
        newBlocksBatchSize = Number(rawValue);
        if (!Number.isSafeInteger(newBlocksBatchSize) || newBlocksBatchSize < 0)
          throw new Error("invalid batch size: " + rawValue);
        break;
      }
      default:
        throw new Error(USAGE);
    }
  }
  await withPool(async (pool) => {
    await main({ pool, newBlocksBatchSize });
  });
}

module.exports = followChain;
