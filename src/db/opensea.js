const dbUtil = require("./util");

const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

// events is an array of JSON objects from the Opensea API
async function addEvents({ client, events }) {
  const ids = events.map((x) => x.id);
  const types = events.map((x) => x.event_type);
  return await client.query(
    `
    INSERT INTO opensea_events_raw (event_id, json, consumed, event_type)
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
    FROM opensea_events_raw
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
    UPDATE opensea_events_raw
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

async function aggregateSalesByProject({ client, afterDate }) {
  const result = await client.query(
    `
    SELECT
      sum(price) AS sum,
      projects.project_id AS "projectId",
      min(slug) AS slug
    FROM opensea_sales
    JOIN tokens
      ON
        opensea_sales.token_id = tokens.on_chain_token_id AND
        opensea_sales.token_contract = tokens.token_contract
    JOIN projects
      ON tokens.project_id = projects.project_id
    WHERE sale_time >= $1 AND
      (currency_contract IS NULL OR currency_contract = $2)
    GROUP BY projects.project_id
    ORDER BY sum(price) DESC
    `,
    [afterDate, dbUtil.hexToBuf(WETH_ADDRESS)]
  );
  return result.rows.map((x) => ({
    slug: x.slug,
    projectId: x.projectId,
    totalEthSales: BigInt(x.sum),
  }));
}

async function salesForToken({ client, tokenContract, tokenId }) {
  const result = await client.query(
    `
    SELECT
      event_id AS "eventId",
      token_id AS "tokenId",
      sale_time AS "saleTime",
      token_contract,
      currency_contract,
      price,
      buyer_address,
      seller_address
    FROM opensea_sales
    WHERE token_contract = $1 AND token_id = $2
    ORDER BY sale_time ASC
    `,
    [dbUtil.hexToBuf(tokenContract), tokenId]
  );
  return result.rows.map((x) => ({
    eventId: x.eventId,
    tokenId: x.tokenId,
    saleTime: x.saleTime,
    price: BigInt(x.price),
    tokenContract: dbUtil.bufToHex(x.token_contract),
    sellerAddress: dbUtil.bufToHex(x.seller_address),
    buyerAddress: dbUtil.bufToHex(x.buyer_address),
    currencyContract: unprepCurrency(x.currency_contract),
  }));
}

const prepCurrency = (x) =>
  x === "0x0000000000000000000000000000000000000000"
    ? null
    : dbUtil.hexToBuf(x);
const unprepCurrency = (x) =>
  x == null ? "0x0000000000000000000000000000000000000000" : dbUtil.bufToHex(x);

module.exports = {
  addEvents,
  getUnconsumedEvents,
  consumeEvents,
  getLastUpdated,
  setLastUpdated,
  addSales,
  aggregateSalesByProject,
  salesForToken,
  WETH_ADDRESS,
};
