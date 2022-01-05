async function up({ client }) {
  await client.query(`
    ALTER TABLE opensea_events_raw
      DROP COLUMN consumed;

    ALTER TABLE opensea_events_raw
      DROP COLUMN event_type;

    DROP TABLE opensea_sales;
  `);
}

module.exports = { up };
