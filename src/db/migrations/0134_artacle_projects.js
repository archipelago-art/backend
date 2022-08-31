async function up({ client }) {
  await client.query(`
    CREATE TABLE artacle_projects(
      project_id projectid PRIMARY KEY REFERENCES projects(project_id),
      artacle_slug text NOT NULL,
      update_time timestamptz NOT NULL
    );
  `);
}

module.exports = { up };
