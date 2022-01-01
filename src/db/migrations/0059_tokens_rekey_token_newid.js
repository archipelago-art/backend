async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members
      DROP CONSTRAINT trait_members_token_id_fkey,
      ALTER COLUMN token_id TYPE int8,  -- will eventually be "tokenid"
      ALTER COLUMN token_id DROP NOT NULL;
    ALTER TABLE tokens
      DROP CONSTRAINT tokens_pkey,
      ADD PRIMARY KEY (token_newid),
      ALTER COLUMN token_id TYPE int8,  -- will eventually be "tokenid"
      ALTER COLUMN token_id DROP NOT NULL;
      ;
  `);
}

module.exports = { up };
