const { withPool } = require("../db/util");
const tokenTransfers = require("../eth/tokenTransfers");

async function alchemyPokeTransfers(args) {
  if (args.length !== 3) {
    throw new Error(
      "usage: alchemy-poke-transfers <contract> <start-block> <end-block>"
    );
  }
  const [contractAddress, rawStartBlock, rawEndBlock] = args;
  const startBlock = Number(rawStartBlock);
  const endBlock = Number(rawEndBlock);
  await withPool(async (pool) => {
    await tokenTransfers.ingestTransfersInRange({
      pool,
      contractAddress,
      startBlock,
      endBlock,
    });
  });
}

module.exports = alchemyPokeTransfers;
