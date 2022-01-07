async function up({ client }) {
  await client.query(
    `CREATE INDEX opensea_asks_token_id ON opensea_asks (token_id)`
  );
}

module.exports = { up };
