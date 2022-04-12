const ethers = require("ethers");

const dbEth = require("../db/eth");
const { acqrel, withPool } = require("../db/util");
const log = require("../util/log")(__filename);
const retry = require("../util/retry");
const signal = require("../util/signal");

const BLOCK_CONCURRENCY = 16; // how many concurrent calls to `getBlock`?

const PREGENESIS_BLOCK_HASH = "0x" + "00".repeat(32);

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function retryEthers(cb) {
  async function attempt() {
    try {
      const value = await cb();
      return { type: "DONE", value };
    } catch (e) {
      if (e.code != null && retryableCodes.includes(e.code)) {
        log.debug`retrying Ethers operation due to ${e.code}: ${e}`;
        return { type: "RETRY", err: e };
      }
      return { type: "FATAL", err: e };
    }
  }
  const res = await retry(attempt);
  if (res.type === "DONE") {
    return res.value;
  } else {
    throw res.err;
  }
}

function makeProvider() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (apiKey == null) throw new Error("missing ALCHEMY_API_KEY");
  const network = process.env.TESTNET === "rinkeby" ? "rinkeby" : "homestead";
  return new ethers.providers.AlchemyProvider(network, apiKey);
}

async function main({ pool }) {
  const provider = makeProvider();
  await Promise.all([syncerMain({ pool, provider })]);
}

async function syncerMain({ pool, provider }) {
  const maxReorgDepth = 20;
  const newBlocksSignal = signal();
  provider.on("block", (number) => {
    newBlocksSignal.set();
  });
  while (true) {
    await newBlocksSignal.wait();
    newBlocksSignal.reset();
    const head = await retryEthers(() => provider.getBlock("latest"));
    log.info`chain head: ${head.hash} at height ${head.number}`;
    const delta = await findDelta({
      pool,
      provider,
      block: head,
      maxDepth: maxReorgDepth,
    });
    switch (delta.type) {
      case "CONVERGES": {
        if (delta.newBlocks.length === 0) {
          log.info`already have head-of-chain block ${head.number} (${head.hash})`;
          break;
        }
        let minBlockNumber = delta.newBlocks[0].number;
        for (const block of delta.newBlocks) {
          if (block.number < minBlockNumber) minBlockNumber = block.number;
        }
        const blocksToRollBack = await acqrel(pool, (client) =>
          dbEth.findLaterBlocks({
            client,
            blockNumberThreshold: minBlockNumber,
          })
        );
        {
          const minus = blocksToRollBack.length;
          const plus = delta.newBlocks.length;
          const kind = minus === 0 ? "clean" : "reorg";
          log.info`block ${head.hash} applies after -${minus}/+${plus} (${kind})`;
        }
        for (const { blockHash, blockNumber } of blocksToRollBack) {
          log.info`rolling back jobs for block ${blockHash} (height ${blockNumber})`;
          await acqrel(pool, (client) => rollBackJobs({ client, blockHash }));
          log.info`dropping block ${blockHash} (height ${blockNumber})`;
          await acqrel(pool, (client) =>
            dbEth.deleteBlock({ client, blockHash })
          );
        }
        for (const block of delta.blocks) {
          log.info`adding block ${block.hash} (height ${block.number})`;
          await acqrel(pool, (client) => dbEth.addBlock({ client, block }));
          log.info`applying jobs for block ${block.hash} (height ${block.number})`;
          await acqrel(pool, (client) =>
            rollForwardJobs({ client, blockHash: block.hash })
          );
        }
        throw new Error("TODO: roll back old blocks, add new blocks");
        break;
      }
      case "DIVERGES": {
        log.info`block ${head.hash} does not converge after ${maxReorgDepth} parents; sleeping`;
        await sleepMs(1000 * 30);
        break;
      }
      case "MISSING_BLOCK": {
        // There was probably a reorg while fetching; retry immediately.
        log.info`missing block ${delta.missingBlockHash} as ancestor of ${head.hash}; retrying`;
        newBlocksSignal.set();
        continue;
      }
    }
  }
}

async function findDelta({ pool, provider, block, maxDepth }) {
  const newBlocks = [];
  for (let i = 0; i < maxDepth; i++) {
    const exists = await acqrel(pool, (client) =>
      dbEth.blockExists({ client, blockHash: block.hash })
    );
    if (exists) {
      newBlocks.reverse(); // now in oldest-first order
      return { type: "CONVERGES", newBlocks };
    } else {
      newBlocks.push(block);
      const parentHash = block.parentHash;
      block = await retryEthers(() => provider.getBlock(parentHash));
      if (block == null) {
        newBlocks.reverse(); // now in oldest-first order
        return {
          type: "MISSING_BLOCK",
          missingBlockHash: parentHash,
          partialNewBlocks: newBlocks,
        };
      }
    }
  }
  log.debug`block ${block.hash} does not converge after ${maxDepth} parents`;
  return {
    type: "DIVERGES",
    partialNewBlocks: newBlocks,
  };
}

/**
 * `block` should be the result of `await provider.getBlock(...)`.
 *
 * Returns `true` if this block and its ancestors now exist in the database.
 * (They may have already existed.) Returns `false` if failed: e.g., if
 * `provider.getBlock(blockHash)` resolves to `null`.
 */
/*
async function processBlock({ pool, provider, block }) {
  const alreadyExists = await acqrel(pool, (client) =>
    eth.blockExists({ client, blockHash: block.blockHash })
  );
  if (alreadyExists) return true;

  const laterBlocks = await acqrel(pool, (client) =>
    eth.findLaterBlocks({ client, blockNumberThreshold: block.blockNumber })
  );
  for (const { blockHash, blockNumber } of laterBlocks) {
    await removeBlock({ pool, blockHash });
  }

  const hasParent = await acqrel(pool, (client) =>
    eth.blockExists({ client, blockHash: block.parentHash })
  );
  if (!hasParent) {
    if (block.parentHash === PREGENESIS_BLOCK_HASH) {
      await addPregenesisBlock({ pool });
    } else {
      const parentBlock = await retryEthers(() =>
        provider.getBlock(block.parentHash)
      );
      if (block == null) {
        log.warn`got null block when looking up ${block.parentHash} as parent of ${block.blockHash} (height ${block.blockNumber})`;
        return false;
      }
      if (!(await processBlock({ pool, provider, block: parentBlock }))) {
        return false;
      }
    }
  }

  // At this point, all the ancestors are in the database.
  await acqrel(pool, async (client) => {
    await eth.addBlocks({
      client,
      blocks: [
        {
          blockHash: block.blockHash,
          parentHash: block.parentHash,
          blockNumber: block.blockNumber,
          blockTimestamp: new Date(block.timestamp * 1000),
        },
      ],
    });
    // TODO: add events
    await rollForwardJobs({ client, blockHash });
  });
  return true;
}

async function addPregenesisBlock({ pool }) {
  await acqrel(pool, (client) =>
    eth.addBlocks({
      client,
      blocks: [
        {
          blockHash: PREGENESIS_BLOCK_HASH,
          parentHash: PREGENESIS_BLOCK_HASH,
          blockNumber: -1,
          blockTimestamp: new Date(0),
        },
      ],
    })
  );
}
*/

async function removeBlock({ pool, blockHash }) {
  await acqrel(pool, async (client) => {
    client.query("BEGIN");
    await rollBackJobs({ client, blockHash });
    await eth.deleteBlock({ client, blockHash });
    client.query("END");
  });
}

async function rollForwardJobs({ client, blockHash }) {
  log.info`would roll forward jobs for ${blockHash}`;
  // TODO
}

async function rollBackJobs({ client, blockHash }) {
  log.info`would roll back jobs for ${blockHash}`;
  // TODO
}

module.exports = main;
