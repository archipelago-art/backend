async function backfillEventTypes({ pool, verbose }) {
  const { rows: typelessEvents } = await pool.query(`
    SELECT event_id AS "eventId", json
    FROM opensea_events
    WHERE event_type IS NULL;
    `);
  const updates = typelessEvents.map(({ eventId, json }) => ({
    eventId,
    eventType: json.event_type,
  }));
  const res = await pool.query(
    `
    UPDATE opensea_events
    SET event_type = updates.event_type
    FROM (
      SELECT unnest($1::text[]) AS event_id, unnest($2::opensea_event_type[]) AS event_type
    ) AS updates
    WHERE opensea_events.event_id = updates.event_id
    `,
    [updates.map((x) => x.eventId), updates.map((x) => x.eventType)]
  );
  if (verbose) {
    const changes = res.rowCount;
    console.log(`updated ${changes} events`);
  }
}

module.exports = backfillEventTypes;
