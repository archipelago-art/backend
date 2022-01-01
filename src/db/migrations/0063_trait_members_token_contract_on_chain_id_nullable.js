async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members
      ALTER COLUMN token_contract DROP NOT NULL,
      ALTER COLUMN on_chain_token_id DROP NOT NULL;
  `);
}

module.exports = { up };
