async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ADD COLUMN artist_name text;
  `);
}

module.exports = { up };
