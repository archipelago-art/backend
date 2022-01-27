async function up({ client }) {
  await client.query(
    `
    ALTER TABLE erc_721_transfers
      ALTER COLUMN block_hash TYPE bytes32 USING block_hash_bytes;
    `
  );
}

module.exports = { up };
