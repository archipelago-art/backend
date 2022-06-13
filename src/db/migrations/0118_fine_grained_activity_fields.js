async function up({ client }) {
  // Notes on expired orders (both bids and asks):
  //
  //   - `active_deadline` conceptually represents `(deadline < now())`,
  //     which of course will necessarily be a lagging indicator: i.e.,
  //     there will be some interval in which the order has expired but
  //     `active_deadline` and `active` have not been updated.
  //
  //   - Once `active_deadline` is set to `false`, it can never be set
  //     to `true` again, so its `active` will also always be `false`.
  //     Thus, as an optimization, we may stop updating other `active_*`
  //     fields: if a user has hundreds of expired bids, it's wasteful
  //     to meticulously track whether the user has sufficient balance
  //     each time that they spend WETH, since the orders can never be
  //     filled anyway.
  await client.query(`
    ALTER TABLE bids
      ADD COLUMN active_currency_balance boolean NOT NULL DEFAULT true,
      ADD COLUMN active_market_approved boolean NOT NULL DEFAULT true,
      ADD COLUMN active_nonce boolean NOT NULL DEFAULT true,
      ADD COLUMN active_deadline boolean NOT NULL DEFAULT true;
    ALTER TABLE asks
      ADD COLUMN active_token_owner boolean NOT NULL DEFAULT true,
      ADD COLUMN active_token_operator boolean NOT NULL DEFAULT false,
      ADD COLUMN active_token_operator_for_all boolean NOT NULL DEFAULT false,
      ADD COLUMN active_market_approved boolean NOT NULL DEFAULT false,
      ADD COLUMN active_market_approved_for_all boolean NOT NULL DEFAULT true,
      ADD COLUMN active_nonce boolean NOT NULL DEFAULT true,
      ADD COLUMN active_deadline boolean NOT NULL DEFAULT true;
  `);
}

module.exports = { up };
