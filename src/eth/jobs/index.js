const artblocks = require("../../db/artblocks");

const makeEchoJob = require("./echo");
const makeErc721TransfersJob = require("./erc721Transfers");

/*::
interface Job {
  /// A cosmetic name for the job, like "echo" or "erc721Transfers(0xa7d8d9...)".
  name(): string;

  /// The block number at which ingestion should start. A value of 0 indicates
  /// that the whole chain should be processed. A positive value indicates that
  /// it is known that there are no events until that block, so some history
  /// can be skipped. (E.g., if tracking transfers on a contract, this might be
  /// the block in which that contract was deployed.)
  startBlock(): number;

  /// The maximum number of blocks that can be processed (with `up`) in a
  /// reasonable amount of time. A typical value is 2000, since that's
  /// Alchemy's cap on the `getFilterLogs` RPC range.
  blockBatchSize(): number;

  /// Processes a range of blocks. This will be called inside a database
  /// transaction; the method MUST NOT commit or roll back the transaction, but
  /// instead either resolve or reject the promise. It MUST be possible to
  /// revert this by calling `down(...)` for each block in the given range, so
  /// data added by this method should generally be keyed by block hash.
  async up({ client, provider, minBlock: number, maxBlock: number }): Promise<void>;

  /// Processes a range of blocks. This will be called inside a database
  /// transaction; the method MUST NOT commit or roll back the transaction. The
  /// returned promise may revert if in a broken state, but this will leave the
  /// system at a standstill and so SHOULD be avoided.
  async down({ client, blockHash, blockNumber }): Promise<void>;
}
*/

const JOBS = [
  makeEchoJob(),
  makeErc721TransfersJob({
    address: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
    startBlock: 11341469,
  }),
  makeErc721TransfersJob({
    address: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    startBlock: 11438389,
  }),
  // ...
];

function getJob(index) {
  const job = JOBS[index];
  if (job == null) throw new Error("no job for index " + index);
  return job;
}

function getAllJobs() {
  return JOBS.slice();
}

module.exports = { getJob, getAllJobs };
