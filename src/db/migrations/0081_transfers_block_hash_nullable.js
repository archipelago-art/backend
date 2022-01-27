async function up({ client }) {
  await client.query(
    `
    ALTER TABLE erc_721_transfers
      ALTER COLUMN block_hash_bytes SET NOT NULL,
      ALTER COLUMN block_hash DROP NOT NULL;
    `
  );
}

module.exports = { up };
