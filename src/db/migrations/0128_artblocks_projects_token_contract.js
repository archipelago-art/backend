async function up({ client }) {
  await client.query(`
    ALTER TABLE artblocks_projects
      ADD COLUMN token_contract address;
  `);
}

module.exports = { up };
