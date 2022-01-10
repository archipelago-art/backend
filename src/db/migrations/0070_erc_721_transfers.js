async function up({ client }) {
  await client.query(`
    CREATE TABLE erc_721_transfer_scan_progress (
      contract_address address PRIMARY KEY REFERENCES projects(token_contract),
      last_scanned_block int8 NOT NULL
    );

    CREATE TABLE erc_721_transfers (
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      transaction_hash text NOT NULL,
      from address NOT NULL,
      to address NOT NULL,
      transaction_timestamp timestamptz NOT NULL,
      block_number int8 NOT NULL,
      transaction_index integer NOT NULL,
      block_hash text NOT NULL
    );

    CREATE UNIQUE INDEX erc_721_transfers_block_number_transaction_index
      ON erc_721_transfers (block_number, transaction_index);

    CREATE INDEX erc_721_transfers_token_id_timestamp
      ON erc_721_transfers (token_id, transaction_timestamp DESC);
  `);
}

module.exports = { up };
