async function up({ client }) {
  await client.query(`
    ALTER TABLE bids
      ALTER COLUMN active_currency_balance DROP DEFAULT,
      ALTER COLUMN active_market_approved DROP DEFAULT,
      ALTER COLUMN active_nonce DROP DEFAULT,
      ALTER COLUMN active_deadline DROP DEFAULT,
      ADD CONSTRAINT active_value CHECK (
        active = (
          active_currency_balance
          AND active_market_approved
          AND active_nonce
          AND active_deadline
        )
      );
    ALTER TABLE asks
      ALTER COLUMN active_token_owner DROP DEFAULT,
      ALTER COLUMN active_token_operator DROP DEFAULT,
      ALTER COLUMN active_token_operator_for_all DROP DEFAULT,
      ALTER COLUMN active_market_approved DROP DEFAULT,
      ALTER COLUMN active_market_approved_for_all DROP DEFAULT,
      ALTER COLUMN active_nonce DROP DEFAULT,
      ALTER COLUMN active_deadline DROP DEFAULT,
      ADD CONSTRAINT active_value CHECK (
        active = (
          (active_token_owner OR active_token_operator OR active_token_operator_for_all)
          AND (active_market_approved OR active_market_approved_for_all)
          AND active_nonce
          AND active_deadline
        )
      );
  `);
}

module.exports = { up };
