async function up({ client }) {
  await client.query(`
    CREATE INDEX erc721_transfers_to_address
      ON erc721_transfers(to_address);
    CREATE INDEX erc721_transfers_from_address
      ON erc721_transfers(to_address);
  `);
}

module.exports = { up };
