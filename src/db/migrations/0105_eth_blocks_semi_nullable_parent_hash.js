async function up({ client }) {
  await client.query(
    `
    -- Give the genesis block a "parent_hash" of SQL "NULL" so that it doesn't
    -- participate in foreign key checks.
    ALTER TABLE eth_blocks
      ALTER COLUMN parent_hash DROP NOT NULL,
      ADD CONSTRAINT eth_blocks_parent_hash_mostly_non_null CHECK (
        -- This inequality will become an equality once the genesis hash is
        -- updated.
        (parent_hash IS NULL) <= (block_number = 0)
      );
    `
  );
}

module.exports = { up };
