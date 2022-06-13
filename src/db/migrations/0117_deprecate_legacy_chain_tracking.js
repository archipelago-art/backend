async function up({ client }) {
  await client.query(`
    ALTER TABLE erc_721_transfers
      RENAME TO deprecated_erc_721_transfers;
    ALTER TABLE erc_721_transfers_deferred
      RENAME TO deprecated_erc_721_transfers_deferred;
    ALTER TABLE erc_721_transfer_scan_progress
      RENAME TO deprecated_erc_721_transfer_scan_progress;
    ALTER TABLE eth_blocks1
      RENAME TO deprecated_eth_blocks1;
  `);
}

async function down({ client }) {
  await client.query(`
    ALTER TABLE deprecated_erc_721_transfers
      RENAME TO erc_721_transfers;
    ALTER TABLE deprecated_erc_721_transfers_deferred
      RENAME TO erc_721_transfers_deferred;
    ALTER TABLE deprecated_erc_721_transfer_scan_progress
      RENAME TO erc_721_transfer_scan_progress;
    ALTER TABLE deprecated_eth_blocks1
      RENAME TO eth_blocks1;
  `);
}

module.exports = { up, down };
