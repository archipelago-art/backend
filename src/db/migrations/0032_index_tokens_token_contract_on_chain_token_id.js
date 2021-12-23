async function up({ client }) {
  await client.query(`
    CREATE UNIQUE INDEX tokens_token_contract_on_chain_token_id
      ON tokens(token_contract, on_chain_token_id);
  `);
}

module.exports = { up };
