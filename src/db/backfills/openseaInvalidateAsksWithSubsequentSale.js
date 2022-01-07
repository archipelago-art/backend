const log = require("../../util/log")(__filename);

async function backfill({ pool, verbose }) {
  const res1 = await pool.query(
    `
    UPDATE opensea_asks
    SET active = false
    WHERE active AND listing_time <= (
      SELECT max(transaction_timestamp) FROM opensea_sales
      WHERE opensea_sales.token_id = opensea_asks.token_id
    )
     `
  );
  const res2 = await pool.query(
    `
    UPDATE opensea_asks
    SET active = false
    WHERE active AND listing_time <= (
      SELECT max(transaction_timestamp) FROM opensea_transfers
      WHERE opensea_transfers.token_id = opensea_asks.token_id
    )
     `
  );
  if (verbose) {
    log.info`Invalidated ${res1.rowCount + res2.rowCount} asks`;
  }
}

module.exports = backfill;
