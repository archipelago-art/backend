async function up({ client }) {
  await client.query(`
    ALTER TABLE opensea_progress
      ALTER COLUMN token_contract TYPE text;
    ALTER TABLE opensea_progress
      RENAME COLUMN token_contract TO opensea_slug;
  `);
}

module.exports = { up };
