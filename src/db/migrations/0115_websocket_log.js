async function up({ client }) {
  await client.query(`
    CREATE TABLE websocket_log (
      message_id uuid PRIMARY KEY,
      create_time timestamptz NOT NULL,
      message_type text NOT NULL,
      topic text NOT NULL,
      data jsonb NOT NULL
    );
    CREATE INDEX websocket_log_create_time
      ON websocket_log(create_time);
    CREATE INDEX websocket_log_topic_create_time
      ON websocket_log(topic, create_time);
  `);
}

module.exports = { up };
