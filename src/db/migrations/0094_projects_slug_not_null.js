async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ALTER COLUMN slug SET NOT NULL;
  `);
}

module.exports = { up };
