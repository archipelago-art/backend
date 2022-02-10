async function up({ client }) {
  await client.query(`
    CREATE INDEX erc_721_transfers_from_address_to_address
      ON erc_721_transfers(from_address, to_address);
  `);
}

module.exports = { up };
