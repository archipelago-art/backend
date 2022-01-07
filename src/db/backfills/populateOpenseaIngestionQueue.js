const log = require("../../util/log")(__filename);

async function backfillIngestionQueue({ pool, verbose }) {
  const res = await pool.query(
    `
    INSERT INTO opensea_events_ingestion_queue (event_id, event_type)
    SELECT event_id, (json->>'event_type')::opensea_event_type
    FROM opensea_events_raw
     `
  );
  if (verbose) {
    log.info`Added ${res.rowCount} events to ingestion queue`;
  }
}

module.exports = backfillIngestionQueue;
