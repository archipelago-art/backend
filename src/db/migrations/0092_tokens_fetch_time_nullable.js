async function up({ client }) {
  await client.query(`
    ALTER TABLE tokens
      ALTER COLUMN fetch_time DROP NOT NULL;
  `);
}

module.exports = { up };
