async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      DROP CONSTRAINT projects_pkey,
      ADD PRIMARY KEY (project_newid),
      ALTER COLUMN project_id TYPE int8,  -- will eventually be "projectid"
      ALTER COLUMN project_id DROP NOT NULL;
    ALTER TABLE tokens
      ALTER COLUMN project_id TYPE int8;  -- will eventually be "projectid"
  `);
}

module.exports = { up };
