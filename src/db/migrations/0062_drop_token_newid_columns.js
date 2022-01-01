async function up({ client }) {
  await client.query(`
    ALTER TABLE tokens DROP COLUMN deprecated_token_newid;
    ALTER TABLE trait_members DROP COLUMN deprecated_token_newid;
  `);
}

module.exports = { up };
