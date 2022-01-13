const log = require("../../util/log")(__filename);

async function backfill({ pool, verbose }) {
  const res = await pool.query(
    `
    DELETE FROM opensea_asks
    WHERE (
      SELECT json->>'is_private' = 'true'
      FROM opensea_events_raw
      WHERE opensea_events_raw.event_id = opensea_asks.event_id
    )
    RETURNING event_id
    `
  );
  if (verbose) {
    log.info`Removed ${res.rowCount} asks`;
  }
}

module.exports = backfill;
