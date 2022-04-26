async function up({ client }) {
  await client.query(`
    ALTER TABLE opensea_ask_cancellations
      ADD COLUMN price uint256 NOT NULL;

    ALTER TABLE opensea_ask_cancellations
      DROP COLUMN listing_time;
  `);
}

module.exports = { up };
