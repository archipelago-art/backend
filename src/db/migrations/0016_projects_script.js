async function up({ client }) {
  await client.query(`
    ALTER TABLE projects ADD COLUMN script text;
  `);
}

module.exports = { up };
