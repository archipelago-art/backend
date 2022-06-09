const ethers = require("ethers");

const log = require("../../util/log")(__filename);
const channels = require("../channels");
const { ObjectType, newIds } = require("../id");
const { bufToAddress, hexToBuf } = require("../util");
const ws = require("../ws");

// events is an array of JSON objects from the Opensea API
async function addRawEvents({ client, events }) {
  const insertions = await client.query(
    `
    INSERT INTO opensea_events_raw (event_id, json)
    VALUES (unnest($1::text[]), unnest($2::jsonb[]))
    ON CONFLICT DO NOTHING
    RETURNING json
    `,
    [events.map((x) => x.id), events]
  );
  const newEvents = insertions.rows.map((x) => x.json);
  await client.query(
    `
    INSERT INTO opensea_events_ingestion_queue (event_id, event_type)
    VALUES (unnest($1::text[]), unnest($2::opensea_event_type[]))
    `,
    [newEvents.map((x) => x.id), newEvents.map((x) => x.event_type)]
  );
  return newEvents.length;
}

async function removeIdsFromIngestionQueue(client, ids) {
  const res = await client.query(
    `
    DELETE FROM opensea_events_ingestion_queue
    WHERE event_id = ANY($1::text[])
    `,
    [ids]
  );
  if (res.rowCount !== ids.length) {
    throw new Error(
      `updated ${res.rowCount} events but had ${ids.length} event ids`
    );
  }
}

async function undeferEvents(client) {
  await client.query("BEGIN");
  const deferred = await client.query(
    `
    SELECT count(1) FROM opensea_events_ingestion_deferred
    `
  );
  const numDeferred = deferred.rows[0].count;
  const rows = (
    await client.query(`
    SELECT event_id AS ID, event_type AS type
    FROM opensea_events_ingestion_deferred
    JOIN tokens USING (token_contract, on_chain_token_id)
    `)
  ).rows;
  const ids = rows.map((x) => x.id);
  const types = rows.map((x) => x.type);
  await client.query(
    `
    DELETE FROM opensea_events_ingestion_deferred
    WHERE event_id = ANY($1::text[])
    `,
    [ids]
  );
  await client.query(
    `
    INSERT INTO opensea_events_ingestion_queue (event_id, event_type)
    VALUES (unnest($1::text[]), unnest($2::opensea_event_type[]))
    `,
    [ids, types]
  );
  log.info`there are ${numDeferred} deferred events; ${ids.length} are now ready`;
  await client.query("COMMIT");
}

async function ingestEvents({ client, perPage = 1000 }) {
  await undeferEvents(client);
  while (true) {
    const numUpdates = await ingestEventPage(client, perPage);
    if (numUpdates < perPage) {
      break;
    }
  }
  await deactivateExpiredAsks({ client });
}

async function ingestEventPage(client, limit) {
  await client.query("BEGIN");
  const events = (
    await client.query(
      `
    SELECT event_id AS "id", event_type AS "type"
    FROM opensea_events_ingestion_queue
    LIMIT $1
    `,
      [limit]
    )
  ).rows;

  const idsToSkip = new Set([
    ...(await transactionsToSkip(client, events)),
    ...(await asksToSkip(client, events)),
    ...(await cancellationsToSkip(client, events)),
  ]);
  const validEvents = events.filter((x) => !idsToSkip.has(x.id));

  const idsMatchingType = (target) =>
    validEvents.filter((x) => x.type === target).map((x) => x.id);

  const askIds = idsMatchingType("created");
  const saleIds = idsMatchingType("successful");
  const cancellationIds = idsMatchingType("cancelled");

  await addNewCurrencies(client, [...askIds, ...saleIds]);

  const insertedSaleIds = await ingestSales(client, saleIds);
  const insertedAskIds = await ingestAsks(client, askIds);
  const insertedCancellationIds = await ingestCancellations(
    client,
    cancellationIds
  );

  const idsToDefer = new Set(validEvents.map((x) => x.id));
  const insertedIds = [
    ...insertedSaleIds,
    ...insertedAskIds,
    ...insertedCancellationIds,
  ];
  for (const id of insertedIds) {
    idsToDefer.delete(id);
  }

  await client.query(
    `
    INSERT INTO opensea_events_ingestion_deferred (
      event_id,
      event_type,
      token_contract,
      on_chain_token_id
    )
    SELECT
      event_id,
      (json->>'event_type')::opensea_event_type,
      hexaddr(json->'asset'->>'address'),
      (json->'asset'->>'token_id')::uint256
    FROM opensea_events_raw
    WHERE event_id = ANY($1::text[])
    ON CONFLICT (event_id) DO NOTHING
    `,
    [[...idsToDefer]]
  );

  await removeIdsFromIngestionQueue(
    client,
    events.map((x) => x.id)
  );

  log.info`ingested ${events.length} events: Insert ${insertedIds.length} Defer ${idsToDefer.size} Skip ${idsToSkip.size}`;

  await client.query("COMMIT");
  return events.length;
}

async function ingestSales(client, saleIds) {
  const result = await client.query(
    `
      INSERT INTO opensea_sales (
        event_id,
        project_id,
        token_id,
        seller_address,
        buyer_address,
        transaction_timestamp,
        transaction_hash,
        listing_time,
        price,
        currency_id
      )
      SELECT
        event_id,
        tokens.project_id,
        tokens.token_id,
        hexaddr(json->'seller'->>'address') AS seller_address,
        hexaddr(json->'winner_account'->>'address') AS buyer_address,
        (json->'transaction'->>'timestamp')::timestamp AT TIME ZONE 'UTC' AS transaction_timestamp,
        json->'transaction'->>'transaction_hash' AS transaction_hash,
        (json->>'listing_time')::timestamp AT TIME ZONE 'UTC' AS listing_time,
        (json->>'total_price')::uint256 AS price,
        currency_id
      FROM opensea_events_raw
      JOIN tokens
        ON hexaddr(json->'asset'->>'address') = token_contract
        AND (json->'asset'->>'token_id')::uint256 = on_chain_token_id
      JOIN currencies ON (
        -- This could be more efficient if we add the opensea currency id to our db
        hexaddr(opensea_events_raw.json->'payment_token'->>'address') = currencies.address
      )
      WHERE event_id = ANY($1::text[])
      RETURNING event_id AS id
    `,
    [saleIds]
  );
  const insertedSales = result.rows.map((x) => x.id);
  await client.query(
    `
    UPDATE opensea_asks
    SET active = false
    WHERE event_id IN (
      SELECT opensea_asks.event_id
      FROM opensea_asks JOIN opensea_sales USING (token_id)
      WHERE active
        AND opensea_asks.listing_time <= opensea_sales.transaction_timestamp
        AND opensea_sales.event_id = ANY($1::text[])
    )
    `,
    [insertedSales]
  );
  return insertedSales;
}

/**
 * The "successful" and "cancelled" event types correspond to Ethereum
 * transactions. Sometimes, those transactions are orphaned. OpenSea still
 * provides them, but they have null hash and timestamp. There's no upside for
 * tracking these, so we remove them from the ingestion queue without actually
 * ingesting them.
 */
async function transactionsToSkip(client, events) {
  const transactionIds = events
    .filter((x) => x.type !== "created")
    .map((x) => x.id);
  const invalidTransactions = await client.query(
    `
    SELECT event_id AS id FROM opensea_events_raw
    WHERE event_id = ANY($1::text[])
    AND (
      json->'transaction'->>'transaction_hash' IS NULL
      OR json->'transaction'->>'timestamp' IS NULL
    )
    `,
    [transactionIds]
  );
  return invalidTransactions.rows.map((x) => x.id);
}

/**
 * Opensea provides (at least) two Ask types: "dutch" and "english".
 * The english auctions are really annoying and no-one uses them.
 * The dutch auctions are normal asks (modulo starting price / ending price weirdness).
 * We only care about the dutch asks. All other types, we will remove from queue and
 * skip.
 *
 * We also skip private asks, since they aren't of general interest and displaying them
 * as an offer would be misleading.
 *
 * We also skip asks with null listing time, to avoid opensea data corruption issues.
 */
async function asksToSkip(client, events) {
  const ids = events.filter((x) => x.type === "created").map((x) => x.id);
  const invalidAsks = await client.query(
    `
    SELECT event_id AS id FROM opensea_events_raw
    WHERE event_id = ANY($1::text[])
    AND (
      json->>'auction_type' != 'dutch'
      OR json->>'is_private' = 'true'
      OR json->>'listing_time' IS NULL
    )
    `,
    [ids]
  );
  return invalidAsks.rows.map((x) => x.id);
}

async function ingestAsks(client, askIds) {
  const result = await client.query(
    `
    INSERT INTO opensea_asks AS oa (
      event_id,
      project_id,
      token_id,
      seller_address,
      listing_time,
      expiration_time,
      price,
      currency_id,
      active
    )
    SELECT
      event_id,
      tokens.project_id,
      tokens.token_id,
      hexaddr(json->'seller'->>'address') AS seller_address,
      (json->>'listing_time')::timestamp AT TIME ZONE 'UTC' AS listing_time,
      (json->>'listing_time')::timestamp AT TIME ZONE 'UTC' +
        make_interval(secs => (json->>'duration')::double precision)
        AS expiration_time,
      (json->>'starting_price')::uint256 AS starting_price,
      currency_id,
      (
        (SELECT NOT EXISTS (
          SELECT 1
          FROM opensea_ask_cancellations
          WHERE opensea_ask_cancellations.token_id = tokens.token_id AND
          price = (json->>'starting_price')::uint256 AND
          transaction_timestamp >= (json->>'listing_time')::timestamp AT TIME ZONE 'UTC'
          )
        ) AND
        (SELECT NOT EXISTS (
          SELECT 1
          FROM opensea_sales
          WHERE opensea_sales.token_id = tokens.token_id AND
          transaction_timestamp >= (json->>'listing_time')::timestamp AT TIME ZONE 'UTC'
          )
        ) AND
        -- opensea deployed the wyvern v2 contract on this date
        (json->>'listing_time')::timestamp AT TIME ZONE 'UTC' > '2022-02-01'
      )
    FROM opensea_events_raw
    JOIN tokens ON (
      hexaddr(json->'asset'->>'address') = token_contract
      AND (json->'asset'->>'token_id')::uint256 = on_chain_token_id
    )
    JOIN currencies ON (
      -- This could be more efficient if we add the opensea currency id to our db
      hexaddr(opensea_events_raw.json->'payment_token'->>'address') = currencies.address
    )
    WHERE event_id = ANY($1::text[])
    RETURNING
      event_id AS "id",
      project_id AS "projectId",
      token_id AS "tokenId",
      (SELECT slug FROM projects p WHERE p.project_id = oa.project_id) AS "slug",
      (SELECT token_index FROM tokens t WHERE t.token_id = oa.token_id) AS "tokenIndex",
      seller_address AS "seller",
      price AS "price",
      listing_time AS "timestamp",
      expiration_time AS "expirationTime"
    `,
    [askIds]
  );

  const messages = result.rows.map((r) => ({
    type: "ASK_PLACED",
    topic: r.slug,
    data: {
      orderId: `opensea:${r.id}`,
      projectId: r.projectId,
      tokenId: r.tokenId,
      slug: r.slug,
      tokenIndex: r.tokenIndex,
      venue: "OPENSEA",
      seller: bufToAddress(r.seller),
      currency: "ETH",
      price: r.price,
      timestamp: r.timestamp.toISOString(),
      expirationTime: r.expirationTime && r.expirationTime.toISOString(),
    },
  }));
  await ws.sendMessages({ client, messages });

  return result.rows.map((x) => x.id);
}

async function cancellationsToSkip(client, events) {
  const ids = events.filter((x) => x.type === "cancelled").map((x) => x.id);
  const invalid = await client.query(
    `
    SELECT event_id AS id FROM opensea_events_raw
    WHERE event_id = ANY($1::text[])
    AND json->>'total_price' IS NULL
    `,
    [ids]
  );
  return invalid.rows.map((x) => x.id);
}

async function ingestCancellations(client, cancellationIds) {
  const result = await client.query(
    `
    INSERT INTO opensea_ask_cancellations (
      event_id,
      project_id,
      token_id,
      transaction_timestamp,
      transaction_hash,
      price
    )
    SELECT
      event_id,
      tokens.project_id,
      tokens.token_id,
      (json->'transaction'->>'timestamp')::timestamp AT TIME ZONE 'UTC' AS transaction_timestamp,
      json->'transaction'->>'transaction_hash' AS transaction_hash,
      (json->>'total_price')::uint256 AS price
    FROM opensea_events_raw
    JOIN tokens
      ON hexaddr(json->'asset'->>'address') = token_contract
      AND (json->'asset'->>'token_id')::uint256 = on_chain_token_id
    WHERE event_id = ANY($1::text[])
    RETURNING event_id AS id
    `,
    [cancellationIds]
  );
  const insertedCancellations = result.rows.map((x) => x.id);
  await client.query(
    `
    UPDATE opensea_asks
    SET active = false
    WHERE event_id IN (
      SELECT opensea_asks.event_id
      FROM opensea_asks JOIN opensea_ask_cancellations USING (token_id)
      WHERE opensea_ask_cancellations.event_id = ANY($1::text[])
        AND opensea_asks.price = opensea_ask_cancellations.price
        AND opensea_asks.listing_time <= opensea_ask_cancellations.transaction_timestamp
    )
    `,
    [insertedCancellations]
  );
  return insertedCancellations;
}

async function addNewCurrencies(client, ids) {
  const res = await client.query(
    `
    SELECT DISTINCT ON (json->'payment_token'->>'address')
      json->'payment_token' AS "token" FROM opensea_events_raw
    WHERE
      event_id = ANY($1::text[])
      AND json->'payment_token' IS NOT NULL
      AND json->'payment_token' <> 'null'::jsonb
      AND NOT EXISTS (
        SELECT 1
        FROM currencies
        WHERE address = hexaddr(json->'payment_token'->>'address')
      )
    `,
    [ids]
  );
  const newPaymentTokens = res.rows;
  if (newPaymentTokens.length === 0) {
    return;
  }
  const currencyIds = newIds(newPaymentTokens.length, ObjectType.CURRENCY);
  await client.query(
    `
    INSERT INTO currencies (
      currency_id,
      address,
      symbol,
      name,
      decimals
    ) VALUES (
      unnest($1::currencyid[]),
      unnest($2::address[]),
      unnest($3::text[]),
      unnest($4::text[]),
      unnest($5::integer[])
    )
    `,
    [
      currencyIds,
      newPaymentTokens.map((x) => hexToBuf(x.token.address)),
      newPaymentTokens.map((x) => x.token.symbol),
      newPaymentTokens.map((x) => x.token.name),
      newPaymentTokens.map((x) => x.token.decimals),
    ]
  );
}

async function deactivateExpiredAsks({ client }) {
  await client.query(
    `
    UPDATE opensea_asks
    SET active = false
    WHERE active AND expiration_time < now()
    `
  );
}

module.exports = {
  addRawEvents,
  ingestEvents,
};
