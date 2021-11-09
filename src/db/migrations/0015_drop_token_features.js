async function up({ client }) {
  await client.query(`
    DROP TABLE deprecated_token_features;
  `);
}

module.exports = { up };
