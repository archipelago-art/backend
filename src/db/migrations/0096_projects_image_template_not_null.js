async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ALTER COLUMN image_template SET NOT NULL;
  `);
}

module.exports = { up };
