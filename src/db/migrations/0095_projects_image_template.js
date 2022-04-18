async function up({ client }) {
  await client.query(`
    ALTER TABLE projects ADD COLUMN image_template text;
  `);
}

module.exports = { up };
