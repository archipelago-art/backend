async function up({ client }) {
  await client.query(`
    CREATE INDEX bids_bidder_nonce
      ON bids(bidder, nonce) WHERE active_deadline;
    CREATE INDEX asks_address_nonce
      ON asks(asker, nonce) WHERE active_deadline;
  `);
}

module.exports = { up };
