async function up({ client }) {
  await client.query(`
    ALTER TABLE eth_blocks RENAME TO eth_blocks1;
  `);
}

module.exports = { up };
