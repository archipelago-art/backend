async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ALTER COLUMN project_id TYPE projectid,
      DROP CONSTRAINT projects_pkey,
      ADD PRIMARY KEY (project_id);
    ALTER TABLE tokens
      ALTER COLUMN project_id TYPE projectid,
      ALTER COLUMN project_newid DROP NOT NULL,
      DROP CONSTRAINT tokens_project_newid_fkey,
      ADD FOREIGN KEY (project_id) REFERENCES projects(project_id);
    ALTER TABLE artblocks_projects
      DROP CONSTRAINT artblocks_projects_project_id_fkey,
      ADD FOREIGN KEY (project_id) REFERENCES projects(project_id);
    ALTER TABLE image_progress
      DROP CONSTRAINT image_progress_project_id_fkey,
      ADD FOREIGN KEY (project_id) REFERENCES projects(project_id);
    ALTER TABLE features
      ADD FOREIGN KEY (project_id) REFERENCES projects(project_id);
  `);
}

module.exports = { up };
