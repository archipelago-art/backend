async function up({ client }) {
  await client.query(`
    BEGIN;
    -- A "feature" is something like "Palette", where a "trait" is something
    -- like "Palette: Paddle".
    CREATE TABLE features (
      feature_id serial PRIMARY KEY,
      project_id integer NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(project_id, name)
    );
    CREATE TABLE traits (
      trait_id serial PRIMARY KEY,
      feature_id integer NOT NULL REFERENCES features(feature_id),
      -- if "feature_id" is set, "project_id" should match
      value JSONB NOT NULL,
      UNIQUE(feature_id, value)
    );
    CREATE TABLE trait_members (
      trait_id integer REFERENCES traits(trait_id),
      token_id integer REFERENCES tokens(token_id),
      UNIQUE(trait_id, token_id)
    );
    COMMIT;
  `);
}

module.exports = { up };
