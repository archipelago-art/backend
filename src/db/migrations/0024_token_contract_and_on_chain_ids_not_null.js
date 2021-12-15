async function up({ client }) {
  await client.query(`
    BEGIN;
    ALTER TABLE projects
      ALTER COLUMN token_contract SET NOT NULL;
    ALTER TABLE tokens
      -- Should match "projects(token_contract)" for this token's project.
      ALTER COLUMN token_contract SET NOT NULL,
      ALTER COLUMN on_chain_token_id SET NOT NULL,
      -- Zero-based index of token within project. (For instance,
      -- Archetype #250 has on-chain token ID 23000250 and token index 250.)
      ALTER COLUMN token_index SET NOT NULL;
    ALTER TABLE trait_members
      ALTER COLUMN token_contract SET NOT NULL,
      ALTER COLUMN on_chain_token_id SET NOT NULL;
    COMMIT;
  `);
}

module.exports = { up };
