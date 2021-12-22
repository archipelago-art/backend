// events is an array of JSON objects from the Opensea API
async function addEvents({ client, events }) {
  const ids = events.map((x) => x.id);
  const types = events.map((x) => x.event_type);
  return await client.query(
    `
    INSERT INTO opensea_events (event_id, json, consumed, event_type)
    VALUES (unnest($1::text[]), unnest($2::jsonb[]), false, unnest($3::opensea_event_type[]))
    ON CONFLICT DO NOTHING
    `,
    [ids, events, types]
  );
}

async function getUnconsumedEvents({ client, limit }) {
  const res = await client.query(
    `
    SELECT event_id AS "eventId", json
    FROM opensea_events
    WHERE NOT consumed
    ORDER BY event_id
    LIMIT $1
    `,
    [limit]
  );
  return res.rows;
}

async function consumeEvents({ client, eventIds }) {
  const res = await client.query(
    `
    UPDATE opensea_events
    SET consumed = true
    WHERE event_id = ANY($1::text[])
    `,
    [eventIds]
  );
  if (res.rowCount !== eventIds.length) {
    throw new Error(
      `updated ${res.rowCount} events but had ${eventIds.length} event ids`
    );
  }
}

// Return the last updated timestamp for a given contract
// slug is an opensea collection slug
async function getLastUpdated({ client, slug }) {
  const res = await client.query(
    `
    SELECT until
    FROM opensea_progress
    WHERE opensea_slug = $1
    `,
    [slug]
  );
  const rows = res.rows;
  if (rows.length === 0) {
    return null;
  }
  return rows[0].until;
}

// slug is an opensea collection slug
// until is a js Date
async function setLastUpdated({ client, slug, until }) {
  await client.query(
    `
    INSERT INTO opensea_progress (opensea_slug, until)
    VALUES ($1, $2)
    ON CONFLICT (opensea_slug) DO UPDATE SET
      until = $2
    `,
    [slug, until]
  );
}

module.exports = {
  addEvents,
  getUnconsumedEvents,
  consumeEvents,
  getLastUpdated,
  setLastUpdated,
};
