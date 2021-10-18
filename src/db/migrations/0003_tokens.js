async function up({ client }) {
  await client.query(`
    CREATE TABLE tokens (
      -- Raw token ID, like "23000250" for Archetype #250.
      token_id integer PRIMARY KEY,
      -- Instant that "token_data" was fetched.
      fetch_time timestamptz NOT NULL,
      -- Raw token data from the Art Blocks API. This is validated as JSON but
      -- is kept in its original form. Will be SQL "NULL" (not JSON "null") if
      -- the fetch 404ed.
      token_data json
    );
    CREATE TABLE token_features (
      token_id integer NOT NULL,
      feature_name text NOT NULL
    );
  `);
}

module.exports = { up };
