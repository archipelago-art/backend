const log = require("../../util/log")(__filename);
const { acqrel } = require("../util");

async function backfillBlockHash({ pool, verbose }) {
  const res = await pool.query(
    `
    UPDATE erc_721_transfers
    SET block_hash = block_hash_bytes
    `
  );
  if (verbose) {
    log.info`updated ${res.rowCount} transfers`;
  }
}

module.exports = backfillBlockHash;
