async function up({ client }) {
  await client.query(`
    CREATE TABLE tokens (
      -- Raw token ID, like "23000250" for Archetype #250.
      token_id INTEGER PRIMARY KEY,
      -- Instant that "token_data" was fetched.
      fetch_time TIMESTAMPTZ NOT NULL,
      -- Raw token data from the Art Blocks API. This is validated as JSON but
      -- is kept in its original form. Will be SQL "NULL" (not JSON "null") if
      -- the fetch 404ed.
      token_data JSON
    );
    CREATE TABLE token_features (
      token_id INTEGER NOT NULL,
      feature_name TEXT NOT NULL
    );
  `);
}

module.exports = { up };
