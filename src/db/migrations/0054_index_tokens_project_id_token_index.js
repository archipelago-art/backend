async function up({ client }) {
  await client.query(`
    CREATE UNIQUE INDEX tokens_project_id_token_index
      ON tokens(project_id, token_index);
  `);
}

module.exports = { up };
