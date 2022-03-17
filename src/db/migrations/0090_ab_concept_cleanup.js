async function up({ client }) {
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
