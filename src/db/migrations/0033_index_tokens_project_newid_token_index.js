async function up({ client }) {
  await client.query(`
    CREATE UNIQUE INDEX tokens_project_newid_token_index
      ON tokens(project_newid, token_index);
  `);
}

module.exports = { up };
