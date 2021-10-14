async function up({ client }) {
  await client.query(`
    BEGIN;
    ALTER TABLE projects ADD COLUMN num_tokens INTEGER;
    UPDATE projects SET num_tokens = (
      SELECT COUNT(1) FROM tokens
      WHERE tokens.project_id = projects.project_id
    );
    ALTER TABLE projects ALTER COLUMN num_tokens SET NOT NULL;
    COMMIT;
  `);
}

module.exports = { up };
