const { ingestBlocks } = require("../../eth/tokenTransfers");
const log = require("../../util/log")(__filename);
const { acqrel, bufToHex } = require("../util");

const RPC_BATCH_SIZE = 128;
const QUERY_BATCH_SIZE = RPC_BATCH_SIZE * 4;

async function backfillBlocks({ pool, verbose }) {
  let total = 0;
  const res = await pool.query(
    `
    SELECT DISTINCT block_hash AS "blockHash" FROM erc_721_transfers
    WHERE block_hash NOT IN (SELECT block_hash FROM eth_blocks)
    `
  );
  const allBlockHashes = res.rows.map((r) => bufToHex(r.blockHash));
  for (let i = 0; i < allBlockHashes.length; i += QUERY_BATCH_SIZE) {
    const blockHashes = allBlockHashes.slice(i, i + QUERY_BATCH_SIZE);
    total += await ingestBlocks({
      pool,
      blockHashes,
      batchSize: RPC_BATCH_SIZE,
    });
  }
  log.info`done: added ${total} blocks`;
}

module.exports = backfillBlocks;
