async function up({ client }) {
  await client.query(`
    CREATE TABLE email_log (
      message_id uuid PRIMARY KEY,
      create_time timestamptz NOT NULL,
      topic text NOT NULL,
      to_email text NOT NULL,
      template_id text NOT NULL,
      template_data jsonb NOT NULL
    );
    CREATE INDEX email_log_create_time
      ON email_log(create_time);
  `);
}

module.exports = { up };
