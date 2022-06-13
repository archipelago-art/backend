async function up({ client }) {
  // Nonces can be cancelled multiple times by explicitly calling
  // `cancelNonces(uint256[])`, but this doesn't do anything because
  // nonces can never be un-cancelled. So, we only track the first
  // cancellation event for each nonce; i.e., inserts to this table can
  // safely be `ON CONFLICT DO NOTHING`.
  await client.query(`
    CREATE TABLE nonce_cancellations (
      market_contract address NOT NULL,
      account address NOT NULL,
      nonce uint256 NOT NULL,
      block_hash bytes32 NOT NULL REFERENCES eth_blocks(block_hash),
      block_number integer NOT NULL,  -- denormalized from "eth_blocks"
      log_index integer NOT NULL,
      transaction_hash bytes32 NOT NULL,
      PRIMARY KEY(market_contract, account, nonce),
      UNIQUE(block_hash, log_index)
    );
    CREATE INDEX nonce_cancellations_market_contract_block_hash
      ON nonce_cancellations (market_contract, block_hash);
  `);
}

module.exports = { up };
