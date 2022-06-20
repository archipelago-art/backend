const artblocks = require("../../db/artblocks");

const makeEchoJob = require("./echo");
const makeErc721TransfersJob = require("./erc721Transfers");
const makeFillsJob = require("./fills");
const makeNonceCancellationsJob = require("./nonceCancellations");
const makeWeth9TransfersJob = require("./weth9Transfers");

const AUTOGLYPHS_ADDRESS = "0xd4e4078ca3495DE5B1d4dB434BEbc5a986197782";
const CRYPTOADZ_ADDRESS = "0x1CB1A5e65610AEFF2551A50f76a87a7d3fB649C6";
const MARKET_MAINNET_ADDRESS = "0x555598409fe9a72f0a5e423245c34555f6445555";

/*::
interface Job {
  /// A cosmetic name for the job, like "echo" or "erc721Transfers(0xa7d8d9...)".
  name(): string;

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

// Each value is a function that takes a JSON object `args` and returns a `Job`
// implementation.
const JOB_IMPLS = {
  echo: makeEchoJob,
  erc721Transfers: makeErc721TransfersJob,
  nonceCancellations: makeNonceCancellationsJob,
  fills: makeFillsJob,
  weth9Transfers: makeWeth9TransfersJob,
};

/*::
interface JobSpec {
  /// A key into `JOB_IMPLS`.
  type: string,

  /// The arguments to be passed to the job creation function.
  args: JsonValue,

  /// The block number at which ingestion should start. A value of 0 indicates
  /// that the whole chain should be processed. A positive value indicates that
  /// it is known that there are no events until that block, so some history
  /// can be skipped. (E.g., if tracking transfers on a contract, this might be
  /// the block in which that contract was deployed.)
  startBlock(): number;
}
*/

const JOB_SPECS = [
  {
    type: "echo",
    args: {},
    startBlock: 0,
  },
  {
    type: "erc721Transfers",
    args: { address: artblocks.CONTRACT_ARTBLOCKS_LEGACY },
    startBlock: 11341469,
  },
  {
    type: "erc721Transfers",
    args: { address: artblocks.CONTRACT_ARTBLOCKS_STANDARD },
    startBlock: 11438389,
  },
  {
    type: "erc721Transfers",
    args: { address: AUTOGLYPHS_ADDRESS },
    startBlock: 7510386,
  },
  {
    type: "erc721Transfers",
    args: { address: CRYPTOADZ_ADDRESS },
    startBlock: 13186834,
  },
  {
    type: "nonceCancellations",
    args: { address: MARKET_MAINNET_ADDRESS },
    startBlock: 14997767,
  },
  {
    type: "fills",
    args: { address: MARKET_MAINNET_ADDRESS },
    startBlock: 14997767,
  },
  {
    type: "weth9Transfers",
    args: {},
    startBlock: 4719568,
  },
  // ...
];

function getJobSpecs() {
  return JOB_SPECS.slice();
}

function makeJobImpl(type, args) {
  return JOB_IMPLS[type](args);
}

module.exports = { getJobSpecs, makeJobImpl };
