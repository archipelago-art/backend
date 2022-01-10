async function up({ client }) {
  await client.query(`
    CREATE TABLE erc_721_transfer_scan_progress (
      contract_address address NOT NULL,
      fetch_time timestamptz NOT NULL,
      block_number integer NOT NULL,
      block_hash text NOT NULL,
      UNIQUE(contract_address, block_hash),
      UNIQUE(contract_address, block_number)
    );

    CREATE INDEX erc_721_transfer_scan_progress_contract_address_block_number
      ON erc_721_transfer_scan_progress(contract_address, block_number DESC);

    CREATE TABLE erc_721_transfers (
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      transaction_hash text NOT NULL,
      from_address address NOT NULL,
      to_address address NOT NULL,
      block_number integer NOT NULL,
      block_hash text NOT NULL,
      log_index integer NOT NULL,
      UNIQUE(block_hash, log_index)
    );

    CREATE INDEX erc_721_transfers_token_id_block_number_log_index
      ON erc_721_transfers (token_id, block_number DESC, log_index DESC);

    CREATE TABLE erc_721_transfers_deferred (
      token_contract address NOT NULL,
      on_chain_token_id uint256 NOT NULL,
      log_object jsonb NOT NULL  -- from Ethers "queryFilter"
    );

    CREATE UNIQUE INDEX ON erc_721_transfers_deferred(
      token_contract,
      on_chain_token_id,
      (log_object->>'blockHash'),
      (log_object->>'logIndex')
    );
  `);
}

module.exports = { up };
