const { getJobProgress, addJob } = require("../db/eth");
const { withClient } = require("../db/util");
const { getAllJobs } = require("../eth/jobs");
const log = require("../util/log")(__filename);

async function followChain(args) {
  if (args.length !== 0) {
    throw new Error("usage: follow-chain");
  }
  await withClient(async (client) => {
    const progress = await getJobProgress({ client });
    log.info`got progress for ${progress.length} jobs`;
    const existingJobs = new Set();
    for (const { jobId } of progress) {
      existingJobs.add(jobId);
    }
    const allJobs = await getAllJobs();
    for (let i = 0; i < allJobs.length; i++) {
      if (existingJobs.has(i)) continue;
      const job = allJobs[i];
      const lastBlockNumber = job.startBlock() - 1;
      log.info`adding job #${i} at block ${lastBlockNumber}`;
      await addJob({ client, jobId: i, lastBlockNumber });
    }
  });
}

module.exports = followChain;
