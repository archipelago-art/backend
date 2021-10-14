async function up({ client }) {
  await client.query(`
    BEGIN;
    ALTER TABLE tokens ADD COLUMN project_id INTEGER;
    UPDATE tokens SET project_id = token_id / 1000000;
    ALTER TABLE tokens ALTER COLUMN project_id SET NOT NULL;
    CREATE INDEX tokens_project_id ON tokens(project_id);
    COMMIT;
  `);
}

module.exports = { up };
