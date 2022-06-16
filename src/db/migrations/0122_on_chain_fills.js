async function up({ client }) {
  // A fill emits two events: `Trade`, with data about the buyer and seller,
  // and `TokenTrade`, with details about the token being traded. These are
  // always emitted in one-to-one correspondence; each such pair gets one row
  // in this table.
  //
  // Arbitrary ERC-721 tokens may be traded on the Archipelago market contract,
  // so `token_id` may be `NULL` for tokens that we don't track. For that
  // reason, we also track the token contract and on-chain token ID of the
  // ERC-721 being traded. When `token_id` is not `NULL`, these fields should
  // match the corresponding row in `tokens`.
  await client.query(`
    CREATE TABLE fills (
      market_contract address NOT NULL,
      trade_id bytes32 NOT NULL,
      PRIMARY KEY(market_contract, trade_id),

      token_id tokenid REFERENCES tokens(token_id),  -- nullable
      project_id projectid REFERENCES projects(project_id),  -- nullable
      CONSTRAINT token_id_iff_project_id CHECK (
        (token_id IS NULL) = (project_id IS NULL)
      ),
      token_contract address NOT NULL,
      on_chain_token_id uint256 NOT NULL,
      buyer address NOT NULL,
      seller address NOT NULL,

      currency currencyid NOT NULL REFERENCES currencies(currency_id),
      price uint256 NOT NULL,
      proceeds uint256 NOT NULL,
      cost uint256 NOT NULL,

      block_hash bytes32 NOT NULL REFERENCES eth_blocks(block_hash),
      block_number integer NOT NULL,  -- denormalized from "eth_blocks"
      log_index integer NOT NULL,  -- of the earlier event
      transaction_hash bytes32 NOT NULL,
      UNIQUE(block_hash, log_index)
    );
    CREATE INDEX fills_market_contract_block_hash
      ON fills(market_contract, block_hash);
    CREATE INDEX fills_token_id_block_number_log_index
      ON fills(token_id, block_number DESC, log_index DESC);
    CREATE INDEX fills_project_id_block_number_log_index
      ON fills(project_id, block_number DESC, log_index DESC) INCLUDE (token_id);
    CREATE INDEX fills_for_unknown_tokens
      ON fills(token_contract, on_chain_token_id) WHERE token_id IS NULL;
  `);
}

module.exports = { up };
