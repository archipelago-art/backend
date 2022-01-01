async function up({ client }) {
  await client.query(`
    ALTER TABLE projects DROP COLUMN deprecated_project_newid;
    ALTER TABLE tokens DROP COLUMN deprecated_project_newid;
  `);
}

module.exports = { up };
