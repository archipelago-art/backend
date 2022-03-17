async function up({ client }) {
  const res = await client.query(`
    SELECT (
      SELECT count(1)
        FROM tokens
        JOIN projects USING (project_id)
        JOIN artblocks_projects USING (project_id)
    ) AS expected,
    (SELECT count(1) FROM artblocks_tokens) AS actual
    `);
  const { expected, actual } = res.rows[0];
  console.log(expected, actual);
  if (expected != actual) {
    throw new Error("not all tokens are migrated!");
  }
  await client.query(`
    ALTER TABLE projects DROP COLUMN script_json;
    ALTER TABLE projects DROP COLUMN script;
    ALTER TABLE tokens DROP COLUMN token_data;
    ALTER TABLE artblocks_projects
      ALTER COLUMN script_json
      SET NOT NULL;
  `);
}

module.exports = { up };
