async function up({ client }) {
  await client.query(`
    ALTER TABLE tokens
      ALTER COLUMN token_index TYPE int;
  `);
}

module.exports = { up };
