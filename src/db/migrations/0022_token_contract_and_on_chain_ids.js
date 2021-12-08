async function up({ client }) {
  await client.query(`
    BEGIN;
    ALTER TABLE projects
      ADD COLUMN token_contract address;
    ALTER TABLE tokens
      -- Should match "projects(token_contract)" for this token's project.
      ADD COLUMN token_contract address,
      ADD COLUMN on_chain_token_id uint256,
      -- Zero-based index of token within project. (For instance,
      -- Archetype #250 has on-chain token ID 23000250 and token index 250.)
      ADD COLUMN token_index int8;
    ALTER TABLE trait_members
      ADD COLUMN token_contract address,
      ADD COLUMN on_chain_token_id uint256;
    COMMIT;
  `);
}

module.exports = { up };
