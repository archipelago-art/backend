const log = require("../../util/log")(__filename);
const { acqrel } = require("../util");

async function backfillBlockHashBytes({ pool, verbose }) {
  const res = await pool.query(
    `
    UPDATE erc_721_transfers
    SET block_hash_bytes = hexbytes(block_hash)::bytes32
    `
  );
  if (verbose) {
    log.info`updated ${res.rowCount} transfers`;
  }
}

module.exports = backfillBlockHashBytes;
