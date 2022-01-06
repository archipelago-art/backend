async function up({ client }) {
  await client.query(`
    CREATE TABLE opensea_events_ingestion_queue (
      event_id TEXT PRIMARY KEY REFERENCES opensea_events_raw(event_id),
      event_type opensea_event_type NOT NULL
    );

    CREATE TABLE opensea_events_ingestion_deferred (
      event_id TEXT PRIMARY KEY REFERENCES opensea_events_raw(event_id),
      event_type opensea_event_type NOT NULL,
      token_contract address NOT NULL,
      on_chain_token_id uint256 NOT NULL
    );

    CREATE TABLE opensea_transfers (
      event_id text PRIMARY KEY REFERENCES opensea_events_raw (event_id),
      project_id projectid NOT NULL REFERENCES projects(project_id),
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      to_address address NOT NULL,
      from_address address NOT NULL,
      transaction_timestamp timestamptz NOT NULL,
      transaction_hash text NOT NULL,
      -- A transfer is "redundant" if it corresponds to a sale in the database.
      -- If so, we should hide it in the UI.
      redundant boolean NOT NULL
    );

    CREATE INDEX opensea_transfers_token_id
      ON opensea_transfers (token_id);

    CREATE TABLE opensea_sales (
      event_id text PRIMARY KEY REFERENCES opensea_events_raw (event_id),
      project_id projectid NOT NULL REFERENCES projects(project_id),
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      seller_address address NOT NULL,
      buyer_address address NOT NULL,
      transaction_timestamp timestamptz NOT NULL,
      transaction_hash text NOT NULL,
      -- May be null if it corresponds to a bid, not a listing
      listing_time timestamptz,
      price uint256 NOT NULL,
      currency_id currencyid NOT NULL REFERENCES currencies (currency_id)
    );

    CREATE INDEX opensea_sales_token_id
      ON opensea_sales (token_id);

    CREATE TABLE opensea_ask_cancellations (
      event_id text PRIMARY KEY REFERENCES opensea_events_raw (event_id),
      project_id projectid NOT NULL REFERENCES projects(project_id),
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      transaction_timestamp timestamptz NOT NULL,
      transaction_hash text NOT NULL,
      listing_time timestamptz NOT NULL
    );

    CREATE INDEX opensea_ask_cancellations_token_id
      ON opensea_ask_cancellations (token_id);

    CREATE TABLE opensea_asks (
      event_id text PRIMARY KEY REFERENCES opensea_events_raw (event_id),
      project_id projectid NOT NULL REFERENCES projects(project_id),
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      seller_address address NOT NULL,
      listing_time timestamptz NOT NULL,
      -- May be null if the ask does not expire.
      expiration_time timestamptz,
      -- Note: The ask actually has starting_price and ending_price fields.
      -- When ending price is not equal to starting price, the listing linearly
      -- descends in price while it is valid.
      -- These are rarely used and we will just always display them at the starting
      -- price; when they come up, the "buyer" can just have a nice surprise when
      -- they page through to token on opensea
      price uint256 NOT NULL,
      currency_id currencyid NOT NULL REFERENCES currencies (currency_id),
      -- Whether or not the ask is still active (ie hasn't been cancelled,
      -- matched, or expired). Note that since expiration happens in real-time,
      -- clients must still check the expiration time at query time, although we
      -- will occasionally mark all expired asks as inactive.
      active boolean NOT NULL
    );

    CREATE INDEX opensea_asks_active_currency_id_project_id_token_id
      ON opensea_asks (active, currency_id, project_id, token_id)
      INCLUDE (price);

    CREATE INDEX opensea_asks_active_currency_id_project_id_price
      ON opensea_asks (active, currency_id, project_id, price ASC);

    CREATE INDEX opensea_asks_expiration_time
      ON opensea_asks (expiration_time ASC NULLS LAST)
      WHERE active;
  `);
}

module.exports = { up };
