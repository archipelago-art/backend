async function up({ client }) {
  await client.query(`
    ALTER TABLE artblocks_projects
      DROP CONSTRAINT artblocks_projects_artblocks_project_index_key,
      ADD UNIQUE (token_contract, artblocks_project_index);
  `);
}

module.exports = { up };
