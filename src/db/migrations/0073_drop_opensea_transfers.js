async function up({ client }) {
  await client.query(`
    DROP TABLE opensea_transfers;
  `);
}

module.exports = { up };
