async function up({ client }) {
  await client.query(
    `
    ALTER TABLE erc_721_transfers
      ADD COLUMN block_hash_bytes bytes32;
    `
  );
}

module.exports = { up };
