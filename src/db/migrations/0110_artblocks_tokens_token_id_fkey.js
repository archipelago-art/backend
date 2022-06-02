async function up({ client }) {
  await client.query(`
    ALTER TABLE artblocks_tokens
      ADD FOREIGN KEY (token_id) REFERENCES tokens(token_id);
  `);
}

module.exports = { up };
