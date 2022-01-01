async function up({ client }) {
  await client.query(`
    ALTER TABLE tokens
      ALTER COLUMN token_id TYPE tokenid,
      DROP CONSTRAINT tokens_pkey,
      ADD PRIMARY KEY (token_id),
      ALTER COLUMN token_newid DROP NOT NULL;
    ALTER TABLE trait_members
      DROP CONSTRAINT trait_members_token_newid_fkey,
      ADD FOREIGN KEY (token_id) REFERENCES tokens(token_id),
      ALTER COLUMN token_newid DROP NOT NULL,
      ALTER COLUMN token_id TYPE tokenid,
      ALTER COLUMN token_id SET NOT NULL;
  `);
}

module.exports = { up };
