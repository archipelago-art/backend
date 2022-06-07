async function up({ client }) {
  // Enforce uniqueness on `(block_number, log_index)` instead of `(block_hash,
  // log_index)`. Assuming that `block_number` is correctly denormalized,
  // because transfers with the same block number must have the same block hash
  // (due to the `UNIQUE` constraint on `eth_blocks.block_number`).
  // By enforcing the constraint on `block_number` instead of `block_hash`, we
  // also gain the ability to order by `block_number DESC, log_index DESC`,
  // which is useful to list recent transfers.
  await client.query(`
    ALTER TABLE erc721_transfers
      DROP CONSTRAINT erc721_transfers_block_hash_log_index_key,
      ADD UNIQUE(block_number, log_index);
  `);
}

module.exports = { up };
