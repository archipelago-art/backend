async function up({ client }) {
  await client.query(`
    ALTER TABLE artblocks_projects
      ADD COLUMN script_json jsonb;

    ALTER TABLE artblocks_projects
      ADD COLUMN script text;

    CREATE TABLE artblocks_tokens (
      token_id tokenid NOT NULL,
      token_data json NOT NULL
    );
  `);
}

module.exports = { up };
