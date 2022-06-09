async function up({ client }) {
  await client.query(`
    DROP INDEX erc721_transfers_from_address;
    CREATE INDEX erc721_transfers_from_address
      ON erc721_transfers(from_address);
  `);
}

module.exports = { up };
