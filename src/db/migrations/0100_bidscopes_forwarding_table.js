async function up({ client }) {
  await client.query(`
    -- Lazily populated table of bid scopes, storing no information but
    -- functioning as a forwarding gadget for FOREIGN KEY constraints.
    CREATE TABLE bidscopes (
      scope bidscope PRIMARY KEY,
      token_id tokenid
        REFERENCES tokens(token_id)
        GENERATED ALWAYS AS (CASE WHEN ((scope >> 58) & 63) = 1 THEN scope END) STORED,
      project_id projectid
        REFERENCES projects(project_id)
        GENERATED ALWAYS AS (CASE WHEN ((scope >> 58) & 63) = 2 THEN scope END) STORED,
      trait_id traitid
        REFERENCES traits(trait_id)
        GENERATED ALWAYS AS (CASE WHEN ((scope >> 58) & 63) = 4 THEN scope END) STORED,
      cnf_id cnfid
        REFERENCES cnfs(cnf_id)
        GENERATED ALWAYS AS (CASE WHEN ((scope >> 58) & 63) = 8 THEN scope END) STORED,
      CONSTRAINT bidscopes_exactly_one_key
        CHECK (
          0
          + (token_id IS NOT NULL)::int
          + (project_id IS NOT NULL)::int
          + (trait_id IS NOT NULL)::int
          + (cnf_id IS NOT NULL)::int
          = 1
        )
    );
  `);
}

module.exports = { up };
