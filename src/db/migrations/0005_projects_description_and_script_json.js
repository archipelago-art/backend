async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ADD COLUMN description TEXT,
      ADD COLUMN script_json JSONB;
  `);
}

module.exports = { up };
