const orderbook = require("../db/orderbook");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function deactivateExpiredOrders(args) {
  if (args.length !== 0) {
    console.error("usage: deactivate-expired-orders");
    return 1;
  }
  await withClient(async (client) => {
    await client.query("BEGIN");
    const res = await orderbook.deactivateExpiredOrders({ client });
    await client.query("COMMIT");
    log.info`deactivated ${res.bids} bids, ${res.asks} asks`;
  });
}

module.exports = deactivateExpiredOrders;
