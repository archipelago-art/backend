const dbUtil = require("./util");

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

async function getUnconsumedEvents({ client, limit, eventType }) {
  const res = await client.query(
    `
    SELECT event_id AS "eventId", json
    FROM opensea_events
    WHERE NOT consumed AND (event_type = $2 OR $2 IS NULL)
    ORDER BY event_id
    LIMIT $1
    `,
    [limit, eventType]
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

async function addSales({ client, sales }) {
  const prepCurrency = (x) =>
    x === "0x0000000000000000000000000000000000000000"
      ? null
      : dbUtil.hexToBuf(x);
  return await client.query(
    `
    INSERT INTO opensea_sales (
      event_id,
      token_contract,
      token_id,
      sale_time,
      price,
      buyer_address,
      seller_address,
      currency_contract
    ) VALUES (
      unnest($1::text[]),
      unnest($2::address[]),
      unnest($3::uint256[]),
      unnest($4::timestamptz[]),
      unnest($5::uint256[]),
      unnest($6::address[]),
      unnest($7::address[]),
      unnest($8::address[])
    )
    `,
    [
      sales.map((x) => x.eventId),
      sales.map((x) => dbUtil.hexToBuf(x.tokenContract)),
      sales.map((x) => x.tokenId),
      sales.map((x) => x.saleTime),
      sales.map((x) => x.price),
      sales.map((x) => dbUtil.hexToBuf(x.buyerAddress)),
      sales.map((x) => dbUtil.hexToBuf(x.sellerAddress)),
      sales.map((x) => prepCurrency(x.currencyContract)),
    ]
  );
}

module.exports = {
  addEvents,
  getUnconsumedEvents,
  consumeEvents,
  getLastUpdated,
  setLastUpdated,
  addSales,
};
