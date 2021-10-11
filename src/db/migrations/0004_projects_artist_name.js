async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ADD COLUMN artist_name TEXT;
  `);
}

module.exports = { up };
