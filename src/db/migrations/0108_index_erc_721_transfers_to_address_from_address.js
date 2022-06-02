async function up({ client }) {
  await client.query(`
    CREATE INDEX erc_721_transfers_to_address_from_address
      ON erc_721_transfers(to_address, from_address);
  `);
}

module.exports = { up };
