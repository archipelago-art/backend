async function up({ client }) {
  await client.query(`
    CREATE UNIQUE INDEX trait_members_token_newid_trait_id
      ON trait_members(token_newid, trait_id);
  `);
}

module.exports = { up };
