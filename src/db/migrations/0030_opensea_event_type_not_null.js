async function up({ client }) {
  await client.query(`
    ALTER TABLE opensea_events
      ALTER COLUMN event_type SET NOT NULL;
  `);
}

module.exports = { up };
