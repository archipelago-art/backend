const log = require("../../util/log")(__filename);

async function backfill({ pool, verbose }) {
  if (verbose) {
    const count = await pool.query(`
    SELECT count(1) FROM opensea_ask_cancellations;
    `);
    log.info`Removing ${count.rows[0].count} cancellations.`;
  }
  await pool.query(
    `
    TRUNCATE opensea_ask_cancellations;
    `
  );
  const res = await pool.query(
    `
    INSERT INTO opensea_events_ingestion_queue (event_id, event_type)
    SELECT event_id, 'cancelled'
    FROM opensea_events_raw
    WHERE json->>'event_type'='cancelled'
    `
  );
  if (verbose) {
    log.info`Added ${res.rowCount} cancellations to queue`;
  }
}

module.exports = backfill;
