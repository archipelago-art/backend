const { ingestBlocks } = require("../../eth/tokenTransfers");
const log = require("../../util/log")(__filename);
const { acqrel, bufToHex } = require("../util");

const RPC_BATCH_SIZE = 256;
const QUERY_BATCH_SIZE = RPC_BATCH_SIZE * 4;

async function backfillBlocks({ pool, verbose }) {
  let total = 0;
  while (true) {
    const res = await pool.query(
      `
      SELECT DISTINCT block_hash AS "blockHash" FROM erc_721_transfers
      WHERE block_hash NOT IN (SELECT block_hash FROM eth_blocks)
      LIMIT $1
      `,
      [QUERY_BATCH_SIZE]
    );
    if (res.rowCount === 0) break;
    const blockHashes = res.rows.map((r) => bufToHex(r.blockHash));
    total += await ingestBlocks({
      pool,
      blockHashes,
      batchSize: RPC_BATCH_SIZE,
    });
  }
  log.info`done: added ${total} blocks`;
}

module.exports = backfillBlocks;
