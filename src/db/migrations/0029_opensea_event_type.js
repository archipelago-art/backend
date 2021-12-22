async function up({ client }) {
  await client.query(`
    CREATE TYPE opensea_event_type AS ENUM (
      'created',
      'successful',
      'cancelled',
      'bid_entered',
      'bid_withdrawn',
      'transfer',
      'approve'
    );
    ALTER TABLE opensea_events
      ADD COLUMN event_type opensea_event_type;
  `);
}

module.exports = { up };
