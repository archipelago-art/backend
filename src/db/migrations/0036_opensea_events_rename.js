async function up({ client }) {
  await client.query(`
    ALTER TABLE opensea_events
      RENAME TO opensea_events_raw
  `);
}

module.exports = { up };
