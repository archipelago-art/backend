async function up({ client }) {
  // `erc20_deltas` includes one record per block per account that has a
  // nonzero currency delta for that block. This may be due to ERC-20
  // `Transfer` events or due to other deltas, like minting/burning or
  // depositing/withdrawing.
  //
  // `erc20_balances` is effectively a cache of:
  //
  //    SELECT currency_id, account, sum(delta)::uint256 AS balance
  //    FROM erc20_deltas
  //    GROUP BY currency_id, account
  //
  // The summed signed transfers for a given `(currency_id, address)` pair must
  // remain within the range of a `uint256`.
  await client.query(`
    CREATE TABLE erc20_deltas (
      currency_id currencyid NOT NULL,
      account address NOT NULL,
      block_hash bytes32 NOT NULL REFERENCES eth_blocks(block_hash),
      PRIMARY KEY(currency_id, account, block_hash),
      delta numeric(78, 0) NOT NULL  -- fits -UINT256_MAX through UINT256_MAX
    );
    CREATE INDEX erc20_deltas_currency_id_block_hash
      ON erc20_deltas(currency_id, block_hash);
    CREATE TABLE erc20_balances (
      currency_id currencyid NOT NULL,
      account address NOT NULL,
      PRIMARY KEY(currency_id, account),
      balance uint256 NOT NULL
    );
  `);
}

module.exports = { up };
