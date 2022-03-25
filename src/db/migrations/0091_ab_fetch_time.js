async function up({ client }) {
  await client.query(`
    ALTER TABLE artblocks_tokens
      ADD COLUMN fetch_time timestamptz;
  `);
}

module.exports = { up };
