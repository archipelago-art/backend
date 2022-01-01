async function up({ client }) {
  await client.query(`
    ALTER TABLE projects RENAME COLUMN project_newid TO deprecated_project_newid;
    ALTER TABLE tokens RENAME COLUMN project_newid TO deprecated_project_newid;
  `);
}

module.exports = { up };
