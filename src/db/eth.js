const ethers = require("ethers");

const log = require("../util/log")(__filename);
const { bufToAddress, bufToHex, hexToBuf } = require("./util");

async function getJobProgress({ client }) {
  const res = await client.query(
    `
    SELECT job_id AS "jobId", last_block_number AS "lastBlockNumber"
    FROM eth_job_progress
    ORDER BY job_id
    `
  );
  return res.rows;
}

async function addJob({ client, jobId, lastBlockNumber }) {
  await client.query(
    `
    INSERT INTO eth_job_progress (job_id, last_block_number)
    VALUES ($1, $2)
    `,
    [jobId, lastBlockNumber]
  );
}

async function updateJobProgress({ client, jobId, lastBlockNumber }) {
  const res = await client.query(
    `
    UPDATE eth_job_progress
    SET last_block_number = $2
    WHERE job_id = $1
    `,
    [jobId, lastBlockNumber]
  );
  return res.rowCount > 0;
}

/**
 * `block` should have:
 *
 *    hash: bytes32
 *    parentHash: bytes32
 *    number: uint256
 *    timestamp: uint256
 *
 * where each `bytes32` is represented as a 0x... string and each `uint256` can
 * be parsed with `BigNumber.from`.
 */
async function addBlock({ client, block }) {
  await client.query(
    `
    INSERT INTO eth_blocks2 (block_hash, parent_hash, block_number, block_timestamp)
    VALUES ($1::bytes32, $2::bytes32, $3::int, $4::timestamptz)
    ON CONFLICT (block_hash) DO NOTHING
    `,
    [
      hexToBuf(block.hash),
      hexToBuf(block.parentHash),
      ethers.BigNumber.from(block.number).toNumber(),
      new Date(ethers.BigNumber.from(block.timestamp) * 1000),
    ]
  );
}

async function latestBlockHeader({ client }) {
  const res = await client.query(
    `
    SELECT
      block_hash AS "blockHash",
      parent_hash AS "parentHash",
      block_number AS "blockNumber",
      block_timestamp AS "blockTimestamp"
    FROM eth_blocks2
    ORDER BY block_number DESC
    LIMIT 1
    `
  );
  const [row] = res.rows;
  if (row == null) return null;
  return {
    blockHash: bufToHex(row.blockHash),
    parentHash: bufToHex(row.parentHash),
    blockNumber: row.blockNumber,
    blockTimestamp: row.blockTimestamp,
  };
}

async function blockExists({ client, blockHash }) {
  const res = await client.query(
    `
    SELECT 1 FROM eth_blocks2 WHERE block_hash = $1::bytes32
    `,
    [hexToBuf(blockHash)]
  );
  return res.rowCount > 0;
}

/**
 * Finds all blocks with height *at least* `blockNumberThreshold` and returns
 * their hashes and heights, in descending order (newest first).
 */
async function findBlockHeadersSince({ client, minBlockNumber }) {
  const res = await client.query(
    `
    SELECT block_hash AS "blockHash", block_number AS "blockNumber"
    FROM eth_blocks2
    WHERE block_number >= $1
    ORDER BY block_number DESC
    `,
    [minBlockNumber]
  );
  return res.rows.map((r) => ({
    blockHash: bufToHex(r.blockHash),
    blockNumber: r.blockNumber,
  }));
}

async function deleteBlock({ client, blockHash }) {
  const res = await client.query(
    `
    DELETE FROM eth_blocks2 WHERE block_hash = $1::bytes32
    `,
    [hexToBuf(blockHash)]
  );
  return res.rowCount > 0;
}

module.exports = {
  getJobProgress,
  addJob,
  updateJobProgress,
  addBlock,
  latestBlockHeader,
  blockExists,
  findBlockHeadersSince,
  deleteBlock,
};
