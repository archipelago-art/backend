async function up({ client }) {
  await client.query(`
    CREATE TABLE token_traits_queue (
      token_id tokenid PRIMARY KEY REFERENCES tokens(token_id),
      create_time timestamptz NOT NULL
    );
    CREATE INDEX token_traits_queue_create_time
      ON token_traits_queue(create_time);
  `);
}

module.exports = { up };
