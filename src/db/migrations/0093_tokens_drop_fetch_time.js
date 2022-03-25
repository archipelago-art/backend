async function up({ client }) {
  await client.query(`
    ALTER TABLE artblocks_tokens
      ALTER COLUMN fetch_time SET NOT NULL;
    ALTER TABLE tokens
      DROP COLUMN fetch_time;
  `);
}

module.exports = { up };
