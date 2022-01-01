async function up({ client }) {
  await client.query(`
    ALTER TABLE tokens RENAME COLUMN token_newid TO deprecated_token_newid;
    ALTER TABLE trait_members RENAME COLUMN token_newid TO deprecated_token_newid;
  `);
}

module.exports = { up };
