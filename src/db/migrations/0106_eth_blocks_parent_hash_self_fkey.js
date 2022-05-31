async function up({ client }) {
  await client.query(
    `
    ALTER TABLE eth_blocks
      DROP CONSTRAINT eth_blocks_parent_hash_mostly_non_null,
      ADD CONSTRAINT eth_blocks_parent_hash_mostly_non_null CHECK (
        (parent_hash IS NULL) = (block_number = 0)
      ),
      ADD CONSTRAINT eth_blocks_parent_hash_never_explicitly_zero CHECK (
        parent_hash <> '0x0000000000000000000000000000000000000000000000000000000000000000'
      ),
      ADD FOREIGN KEY (parent_hash) REFERENCES eth_blocks(block_hash);
    `
  );
}

module.exports = { up };
