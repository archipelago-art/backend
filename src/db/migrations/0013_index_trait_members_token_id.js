async function up({ client }) {
  await client.query(`
    CREATE INDEX trait_members_token_id_trait_id
      ON trait_members(token_id, trait_id);
  `);
}

module.exports = { up };
