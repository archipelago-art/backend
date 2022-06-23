async function up({ client }) {
  await client.query(`
    DROP TABLE deprecated_erc_721_transfer_scan_progress;
    DROP TABLE deprecated_erc_721_transfers;
    DROP TABLE deprecated_erc_721_transfers_deferred;
    DROP TABLE deprecated_eth_blocks1;
  `);
}

module.exports = { up };
