async function up({ client }) {
  await client.query(`
    CREATE TABLE artblocks_projects (
      project_id projectid PRIMARY KEY REFERENCES projects(project_newid),
      artblocks_project_index integer UNIQUE NOT NULL
    );
  `);
}

module.exports = { up };
