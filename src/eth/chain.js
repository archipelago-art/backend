const ethers = require("ethers");

const dbEth = require("../db/eth");
const { acqrel, withPool } = require("../db/util");
const log = require("../util/log")(__filename);
const retryEthers = require("../util/retryEthers");
const signal = require("../util/signal");
const { getJob } = require("./jobs");

function childLog(prefix) {
  return log.child(prefix);
}

const BLOCK_CONCURRENCY = 16; // how many concurrent calls to `getBlock`?

const PREGENESIS_BLOCK_HASH = "0x" + "00".repeat(32);

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

function makeProvider() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (apiKey == null) throw new Error("missing ALCHEMY_API_KEY");
  const network = process.env.TESTNET === "rinkeby" ? "rinkeby" : "homestead";
  return new ethers.providers.AlchemyProvider(network, apiKey);
}

async function main({ pool, newBlocksBatchSize = null }) {
  const log = childLog("main");
  const provider = makeProvider();

  const newBlocksSignal = signal();
  function blockListener(number) {
    newBlocksSignal.set();
  }
  provider.on("block", blockListener);

  try {
    while (true) {
      // 1. Unroll reorgs.
      {
        const res = await unrollReorgs({ pool, provider });
        switch (res.type) {
          case "OK":
            log.debug`unrollReorgs succeeded, removing ${res.blocksRemoved} blocks`;
            break;
          case "RETRY":
            log.debug`retrying outer loop at request of unrollReorgs`;
            continue;
          default:
            throw new Error(
              "unknown result from unrollReorgs: " + JSON.stringify(res)
            );
        }
      }

      // 2. Get new block headers.
      let moreBlocks = false;
      {
        const res = await addNewHeaders({
          pool,
          provider,
          batchSize: newBlocksBatchSize,
        });
        switch (res.type) {
          case "OK":
            log.debug`addNewHeaders succeeded, adding ${res.blocksAdded} blocks; more=${res.moreBlocks}`;
            if (res.moreBlocks) moreBlocks = true;
            break;
          case "RETRY":
            log.debug`retrying outer loop at request of addNewHeaders`;
            continue;
          default:
            throw new Error(
              "unknown result from addNewHeaders: " + JSON.stringify(res)
            );
        }
      }

      // 3. Apply jobs.
      let moreJobs = false;
      {
        const res = await applyJobs({ pool, provider });
        switch (res.type) {
          case "OK":
            log.debug`applyJobs succeeded; more=${res.moreJobs}`;
            if (res.moreJobs) moreJobs = true;
            break;
          case "RETRY":
            log.debug`retrying outer loop at request of applyJobs`;
            continue;
          default:
            throw new Error(
              "unknown result from applyJobs: " + JSON.stringify(res)
            );
        }
      }

      // Then, just wait for new blocks in order to progress.
      let woke = false;
      let wakeReason;
      if (moreBlocks) {
        wakeReason = "unfinished addNewHeaders";
      } else if (moreJobs) {
        wakeReason = "unfinished applyJobs";
      } else {
        wakeReason = await Promise.race([
          sleepMs(60 * 1000).then(() => "sleep"),
          newBlocksSignal.wait().then(() => {
            if (!woke) newBlocksSignal.reset();
            return "new blocks notification";
          }),
        ]);
      }
      woke = true;
      log.debug`woke from ${wakeReason}`;
    }
  } finally {
    provider.off("block", blockListener);
  }
}

async function unrollReorgs({ pool, provider }) {
  const log = childLog("unrollReorgs");
  const localHead = await acqrel(pool, (client) =>
    dbEth.latestBlockHeader({ client })
  );
  if (localHead == null) {
    log.info`no local blocks; nothing to do`;
    return { type: "OK", blocksRemoved: 0 }; // no blocks implies no reorgs
  }
  // Find the remote block at the same height as our local head.
  const remotePeer = await retryEthers(async () => {
    const number = localHead.blockNumber;
    log.debug`fetching remote peer of local head #${number}`;
    return await provider.getBlock(number);
  });
  if (remotePeer == null) {
    // Remote chain is not expected to ever get shorter.
    throw new Error(
      `no remote block at height ${localHead.blockNumber} (local hash ${localHead.blockHash})`
    );
  }
  if (remotePeer.hash === localHead.blockHash) {
    log.info`local head ${localHead.blockHash} still canonical as #${localHead.blockNumber}`;
    return { type: "OK", blocksRemoved: 0 };
  }

  const maxReorgDepth = 20;
  log.debug`finding merge-base of local head ${localHead.blockHash} and remote peer ${remotePeer.hash}`;
  const mergeBase = await findMergeBase({
    pool,
    provider,
    block: remotePeer,
    maxDepth: maxReorgDepth,
  });
  switch (mergeBase.type) {
    case "CONVERGES": {
      log.info`merge-base is #${mergeBase.base.number} (${mergeBase.base.hash}); reorg depth is ${mergeBase.newBlocks.length}`;
      if (mergeBase.newBlocks.length === 0) {
        // Could happen if the remote chain reorgs to once again be ahead of
        // our local chain, between the "still canonical" check and the
        // `getBlock("latest")` call.
        log.info`already have head-of-chain block ${head.number} (${head.hash})`;
        break;
      }
      const firstBadHeight = mergeBase.newBlocks[0].number;
      await unrollBlocksSince({ pool, provider, firstBadHeight });
      return { type: "OK", blocksRemoved: mergeBase.newBlocks.length };
    }
    case "DIVERGES": {
      throw new Error(
        `block ${remotePeer.hash} does not converge after ${maxReorgDepth} parents`
      );
    }
    case "MISSING_BLOCK": {
      // There was probably a reorg while fetching; retry immediately.
      log.info`missing block ${mergeBase.missingBlockHash} as ancestor of ${remotePeer.hash}; retrying`;
      return { type: "RETRY" };
    }
  }
}

async function unrollBlocksSince({ pool, provider, firstBadHeight }) {
  const blocksToRollBack = await acqrel(pool, (client) =>
    dbEth.findBlockHeadersSince({
      client,
      minBlockNumber: firstBadHeight,
    })
  );
  for (const { blockHash, blockNumber } of blocksToRollBack) {
    await rollBackJobsForBlock({ pool, blockHash, blockNumber });
    log.debug`dropping block ${blockHash} (height ${blockNumber})`;
    await acqrel(pool, (client) => dbEth.deleteBlock({ client, blockHash }));
  }
  log.info`unrolled ${blocksToRollBack.length} blocks from ${firstBadHeight}`;
}

async function addNewHeaders({
  pool,
  provider,
  batchSize: maxBatchSize = null,
}) {
  const log = childLog("addNewHeaders");
  const localHead = await acqrel(pool, (client) =>
    dbEth.latestBlockHeader({ client })
  );
  const remoteHead = await retryEthers(() => provider.getBlock("latest"));
  if (localHead != null && localHead.blockNumber === remoteHead.number) {
    if (localHead.blockHash === remoteHead.hash) {
      const { number, hash } = remoteHead;
      log.info`local and remote heads agree at #${number} with hash ${hash}`;
      return { type: "OK", blocksAdded: 0, moreBlocks: false };
    } else {
      const number = localHead.blockNumber;
      const localHash = localHead.blockHash;
      const remoteHash = remoteHead.hash;
      log.info`local and remote heads disagree at #${number}: local=${localHash}, remote=${remoteHash}`;
      return { type: "RETRY" };
    }
  }

  const localHeadNumber = localHead == null ? -1 : localHead.blockNumber;
  log.info`head heights: local=${localHeadNumber}, remote=${
    remoteHead.number
  }, delta=${remoteHead.number - localHeadNumber}`;
  const minBlock = localHeadNumber + 1;
  let maxBlock = remoteHead.number;
  let moreBlocks = false;
  if (maxBatchSize == null) maxBatchSize = 256;
  if (maxBlock > localHeadNumber + maxBatchSize) {
    maxBlock = localHeadNumber + maxBatchSize;
    moreBlocks = true;
  }
  log.debug`fetching headers for blocks ${minBlock}..=${maxBlock}`;
  const blocks = await Promise.all(
    Array(maxBlock - minBlock + 1)
      .fill()
      .map((_, i) =>
        retryEthers(() => {
          const blockNumber = minBlock + i;
          log.trace`fetching block ${blockNumber}`;
          return provider.getBlock(blockNumber);
        })
      )
  );

  log.debug`fetched ${blocks.length} blocks; adding headers`;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    let expectedParentHash = null;
    if (i > 0) {
      expectedParentHash = blocks[i - 1].hash;
    } else if (localHead != null) {
      expectedParentHash = localHead.blockHash;
    }
    if (expectedParentHash != null && block.parentHash !== expectedParentHash) {
      // This can happen if a reorg occurs between the times that we fetch
      // blocks `i - 1` and `i`.
      log.info`parent hash mismatch: remote#${block.number}.parentHash = ${block.parentHash}, expected ${expectedParentHash}`;
      return { type: "RETRY" };
    } else {
      log.debug`adding block #${block.number} with hash ${block.hash}, parent ${block.parentHash}`;
      await acqrel(pool, (client) => dbEth.addBlock({ client, block }));
    }
  }

  return { type: "OK", blocksAdded: blocks.length, moreBlocks };
}

async function applyJobs({ pool, provider }) {
  const log = childLog("applyJobs");
  const [localHead, jobProgress] = await Promise.all([
    acqrel(pool, (client) => dbEth.latestBlockHeader({ client })),
    acqrel(pool, (client) => dbEth.getJobProgress({ client })),
  ]);
  log.debug`got local head at #${localHead.blockNumber} with ${jobProgress.length} job statuses`;

  const errors = [];
  let moreJobs = false;
  for (const { jobId, lastBlockNumber } of jobProgress) {
    if (lastBlockNumber > localHead.blockNumber) {
      log.warn`job #${jobId} is at ${lastBlockNumber} ahead of local head ${localHead.blockNumber}; skipping`;
      continue;
    }
    if (lastBlockNumber === localHead.blockNumber) {
      log.debug`job #${jobId} up to date at ${lastBlockNumber}; skipping`;
      continue;
    }
    const job = getJob(jobId);
    const minBlock = lastBlockNumber + 1;
    const maxLength = job.blockBatchSize();
    let maxBlock /* inclusive */ = localHead.blockNumber;
    if (maxBlock > minBlock + maxLength - 1) {
      maxBlock = minBlock + maxLength - 1;
      moreJobs = true;
    }
    const res = await rollForwardJobForRange({
      pool,
      provider,
      job,
      jobId,
      minBlock,
      maxBlock,
    });
    if (res.type !== "OK") {
      errors.push({ jobId, error: res.error });
    }
  }

  if (errors.length === 0) return { type: "OK", moreJobs };
  else return { type: "RETRY" };
}

async function findMergeBase({ pool, provider, /* mut */ block, maxDepth }) {
  const newBlocks = [];
  for (let i = 0; i < maxDepth; i++) {
    const exists = await acqrel(pool, (client) =>
      dbEth.blockExists({ client, blockHash: block.hash })
    );
    if (exists) {
      newBlocks.reverse(); // now in oldest-first order
      return { type: "CONVERGES", newBlocks, base: block };
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

async function rollForwardJobForRange({
  pool,
  provider,
  job,
  jobId,
  minBlock,
  maxBlock,
}) {
  try {
    log.info`job ${jobId}:${job.name()}: applying to ${minBlock}..=${maxBlock}`;
    await acqrel(pool, async (client) => {
      await client.query("BEGIN");
      await job.up({ client, provider, minBlock, maxBlock });
      dbEth.updateJobProgress({
        client,
        jobId,
        lastBlockNumber: maxBlock,
      });
      await client.query("COMMIT");
    });
    log.debug`updated job ${jobId} progress to #${maxBlock}`;
    return { type: "OK" };
  } catch (e) {
    log.error`failure applying job ${jobId} to ${minBlock}..=${maxBlock}: ${e} // ${e.stack}`;
    return { type: "ERROR", error: e };
  }
}

async function rollBackJobsForBlock({ pool, blockHash, blockNumber }) {
  log.info`rolling back jobs for ${blockHash} at #${blockNumber}`;
  const jobProgress = await acqrel(pool, (client) =>
    dbEth.getJobProgress({ client })
  );
  for (const { jobId, lastBlockNumber } of jobProgress) {
    const job = getJob(jobId);
    if (lastBlockNumber > blockNumber) {
      throw new Error(
        `job ${jobId}:${job.name()} is at #${lastBlockNumber} > #${blockNumber}; can't roll back`
      );
    } else if (lastBlockNumber === blockNumber) {
      log.debug`job ${jobId}:${job.name()}: rolling back for ${blockHash} at #${blockNumber}`;
      await acqrel(pool, async (client) => {
        await client.query("BEGIN");
        await job.down({ client, blockHash, blockNumber });
        await dbEth.updateJobProgress({
          client,
          jobId,
          lastBlockNumber: blockNumber - 1,
        });
        await client.query("END");
      });
      log.debug`job ${jobId}:${job.name()}: rolled back for ${blockHash} at #${blockNumber}`;
    } else {
      log.debug`job ${jobId}:${job.name()}: at #${lastBlockNumber} < #${blockNumber}; no need to roll back`;
    }
  }
}

module.exports = main;
