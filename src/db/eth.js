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
    VALUES ($1::bytes32[], $2::bytes32[], $3::int[], $4::timestamptz[])
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

async function latestBlockNumber({ client }) {
  const res = await client.query(
    `
    SELECT max(block_number) AS n FROM eth_blocks2
    `
  );
  return res.rows[0].n;
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
async function findLaterBlocks({ client, blockNumberThreshold }) {
  const res = await client.query(
    `
    SELECT block_hash AS "blockHash", block_number AS "blockNumber"
    FROM eth_blocks2
    WHERE block_number >= $1
    ORDER BY block_number DESC
    `,
    [blockNumberThreshold]
  );
  return res.rows;
}

async function deleteBlock({ client, blockHash }) {
  const res = await client.query(
    `
    DELETE FROM eth_blocks2 WHERE block_hash = $1::bytes32
    `,
    [blockHash]
  );
  return res.rowCount > 0;
}

module.exports = {
  addBlock,
  latestBlockNumber,
  blockExists,
  findLaterBlocks,
  deleteBlock,
};
