async function up({ client }) {
  await client.query(
    `
    ALTER TABLE eth_blocks
      DROP CONSTRAINT eth_blocks_parent_hash_never_explicitly_zero;
    `
  );
}

module.exports = { up };
