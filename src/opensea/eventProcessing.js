const {
  getUnconsumedEvents,
  consumeEvents,
  addSales,
} = require("../db/opensea");
const log = require("../util/log")(__filename);

const ETHER_ADDRESS = "0x0000000000000000000000000000000000000000";

async function processSales({ client }) {
  let total = 0;
  while (true) {
    const events = await getUnconsumedEvents({
      client,
      limit: 1000,
      eventType: "successful",
    });
    const jsons = events.map((x) => x.json);
    if (events.length === 0) {
      break;
    }
    const sales = jsons.map((x) => ({
      eventId: x.id,
      tokenContract: x.asset.address,
      tokenId: x.asset.token_id,
      saleTime: x.created_date,
      currencyContract: x.payment_token.address,
      price: x.total_price,
      buyerAddress: x.winner_account.address,
      sellerAddress: x.seller.address,
    }));

    await client.query("BEGIN");
    await addSales({ client, sales });
    await consumeEvents({ client, eventIds: events.map((x) => x.eventId) });
    await client.query("COMMIT");
    log.info`processed ${sales.length} sales`;
    total += sales.length;
  }
  log.info`finished: ${total} sales`;
}

module.exports = { processSales };
