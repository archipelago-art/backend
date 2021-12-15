async function up({ client }) {
  await client.query(`
    CREATE TABLE opensea_events (
      event_id text PRIMARY KEY,
      json jsonb NOT NULL,
      consumed boolean NOT NULL
    );
    CREATE TABLE opensea_progress (
      token_contract address PRIMARY KEY,
      until timestamptz NOT NULL
    );
  `);
}

module.exports = { up };
