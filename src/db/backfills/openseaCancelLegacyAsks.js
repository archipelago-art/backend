const log = require("../../util/log")(__filename);

async function backfill({ pool, verbose }) {
  const res = await pool.query(
    `
    UPDATE opensea_asks
    SET active = false
    WHERE listing_time <= '2022-02-01'
    AND active = true
    `
  );
  if (verbose) {
    log.info`Deactivated ${res.rowCount} asks`;
  }
}

module.exports = backfill;
