async function up({ client }) {
  await client.query(
    `
    CREATE INDEX eth_blocks_parent_hash ON eth_blocks(parent_hash);
    `
  );
}

module.exports = { up };
