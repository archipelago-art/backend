const deepEqual = require("lodash.isequal");

const eth = require("../db/eth");
const { withClient } = require("../db/util");
const { getJobSpecs } = require("../eth/jobs");
const log = require("../util/log")(__filename);

async function followChain(args) {
  if (args.length !== 0) {
    throw new Error("usage: follow-chain");
  }
  await withClient(async (client) => {
    await client.query("BEGIN");

    const currentJobsRes = await eth.getJobs({ client });
    log.info`got ${currentJobsRes.length} existing jobs`;
    const currentJobs = new Map();
    for (const job of currentJobsRes) {
      currentJobs.set(job.jobId, job);
    }

    const targetJobs = await getJobSpecs();
    for (let i = 0; i < targetJobs.length; i++) {
      const target = targetJobs[i];
      const current = currentJobs.get(i);
      if (target.killedAtBlock != null) {
        continue;
      }

      if (current != null) {
        if (current.type == null && current.args == null) {
          const { type, args } = target;
          const s = JSON.stringify;
          log.info`job #${i}: setting type=${type}, args=${s(args)}`;
          const res = await eth.updateJobSpec({ client, jobId: i, type, args });
          if (!res) throw new Error("failed to update job " + i);
          continue;
        }
        if (
          current.type !== target.type ||
          !deepEqual(current.args, target.args)
        ) {
          const s = JSON.stringify;
          log.warn`job #${i}: expected type=${target.type}, args=${s(
            target.args
          )}; got type=${current.type}, args=${s(current.args)}`;
        }
        continue;
      }

      const lastBlockNumber = target.startBlock - 1;
      const s = JSON.stringify;
      const { type, args } = target;
      log.info`adding job #${i} at block ${lastBlockNumber}: type=${type}, args=${s(
        args
      )}`;
      await eth.addJob({ client, jobId: i, lastBlockNumber, type, args });
    }

    await client.query("COMMIT");
  });
}

module.exports = followChain;
