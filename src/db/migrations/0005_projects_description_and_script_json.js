async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ADD COLUMN description text,
      ADD COLUMN script_json jsonb;
  `);
}

module.exports = { up };
