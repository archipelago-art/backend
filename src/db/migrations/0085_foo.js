async function up({ client }) {
  await client.query(
    `
    ALTER TABLE erc_721_transfers
      DROP COLUMN block_hash_bytes;
    `
  );
}

module.exports = { up };
