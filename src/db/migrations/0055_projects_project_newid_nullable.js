async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ALTER COLUMN project_newid DROP NOT NULL;
  `);
}

module.exports = { up };
