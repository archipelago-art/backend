async function up({ client }) {
  await client.query(`
    ALTER TABLE fills RENAME COLUMN currency TO currency_id;
  `);
}

module.exports = { up };
