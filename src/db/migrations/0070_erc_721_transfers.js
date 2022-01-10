async function up({ client }) {
  await client.query(`
    CREATE TABLE erc_721_transfers (
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      transaction_hash text NOT NULL,
      from address NOT NULL,
      to address NOT NULL,
      transaction_timestamp timestamptz NOT NULL
    );

    CREATE INDEX erc_721_transfers_token_id_timestamp
      ON erc_721_transfers (token_id, transaction_timestamp DESC);

  `);
}

module.exports = { up };
