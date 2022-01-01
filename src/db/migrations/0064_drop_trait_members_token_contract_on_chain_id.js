async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members
      DROP COLUMN token_contract,
      DROP COLUMN on_chain_token_id;
  `);
}

module.exports = { up };
