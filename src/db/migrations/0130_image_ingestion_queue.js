async function up({ client }) {
  await client.query(`
    CREATE TABLE image_ingestion_queue (
      token_id tokenid PRIMARY KEY REFERENCES tokens(token_id),
      create_time timestamptz NOT NULL
    );
  `);
}

module.exports = { up };
