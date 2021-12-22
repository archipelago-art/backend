async function up({ client }) {
  await client.query(`
    CREATE TABLE opensea_sales (
      event_id text PRIMARY KEY,
      token_contract address NOT NULL,
      token_id uint256 NOT NULL,
      sale_time timestamptz NOT NULL,
      -- if the currency is ETH, currency_contract is NULL
      currency_contract address,
      price uint256 NOT NULL,
      buyer_address address NOT NULL,
      seller_address address NOT NULL,
      CONSTRAINT currency_contract_nonzero CHECK (
        currency_contract <> '\\x0000000000000000000000000000000000000000'
      )
    )
  `);
}

module.exports = { up };
