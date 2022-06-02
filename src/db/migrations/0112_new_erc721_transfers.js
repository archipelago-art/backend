async function up({ client }) {
  await client.query(`
    CREATE TABLE erc721_transfers (
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      from_address address NOT NULL,
      to_address address NOT NULL,
      block_hash bytes32 NOT NULL REFERENCES eth_blocks(block_hash),
      block_number integer NOT NULL,  -- denormalized from "eth_blocks"
      log_index integer NOT NULL,
      transaction_hash bytes32 NOT NULL,
      UNIQUE(block_hash, log_index)
    );
    CREATE INDEX erc721_transfers_token_id_block_number_log_index
      ON erc721_transfers (token_id, block_number DESC, log_index DESC);
    CREATE INDEX erc721_transfers_block_hash
      ON erc721_transfers (block_hash);
  `);
}

module.exports = { up };
