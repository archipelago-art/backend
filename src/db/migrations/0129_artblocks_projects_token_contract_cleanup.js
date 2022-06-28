async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ADD UNIQUE (project_id, token_contract);

    ALTER TABLE artblocks_projects
      ALTER COLUMN token_contract SET NOT NULL,
      ADD FOREIGN KEY (project_id, token_contract) REFERENCES projects(project_id, token_contract);
  `);
}

module.exports = { up };
