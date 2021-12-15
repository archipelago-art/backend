const { hexToBuf } = require("./util");

// events is an array of JSON objects from the Opensea API
async function addEvents({ client, events }) {
  const ids = events.map((x) => x.id);
  return await client.query(
    `
    INSERT INTO opensea_events (event_id, json, consumed)
    VALUES (unnest($1::text[]), unnest($2::jsonb[]), false)
    ON CONFLICT DO NOTHING
    `,
    [ids, events]
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
// address is a "0x...." string
async function getLastUpdated({ client, address }) {
  const res = await client.query(
    `
    SELECT until
    FROM opensea_progress
    WHERE token_contract = $1
    `,
    [hexToBuf(address)]
  );
  const rows = res.rows;
  if (rows.length === 0) {
    return null;
  }
  return rows[0].until;
}

// address is a "0x..." string
// until is a js Date
async function setLastUpdated({ client, address, until }) {
  await client.query(
    `
    INSERT INTO opensea_progress (token_contract, until)
    VALUES ($1, $2)
    ON CONFLICT (token_contract) DO UPDATE SET
      until = $2
    `,
    [hexToBuf(address), until]
  );
}

module.exports = {
  addEvents,
  getUnconsumedEvents,
  consumeEvents,
  getLastUpdated,
  setLastUpdated,
};
