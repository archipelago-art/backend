const dbUtil = require("../util");

const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

async function addSales({ client, sales }) {
  return await client.query(
    `
    INSERT INTO opensea_sales (
      event_id,
      token_contract,
      token_id,
      sale_time,
      price,
      buyer_address,
      seller_address,
      currency_contract
    ) VALUES (
      unnest($1::text[]),
      unnest($2::address[]),
      unnest($3::uint256[]),
      unnest($4::timestamptz[]),
      unnest($5::uint256[]),
      unnest($6::address[]),
      unnest($7::address[]),
      unnest($8::address[])
    )
    `,
    [
      sales.map((x) => x.eventId),
      sales.map((x) => dbUtil.hexToBuf(x.tokenContract)),
      sales.map((x) => x.tokenId),
      sales.map((x) => x.saleTime),
      sales.map((x) => x.price),
      sales.map((x) => dbUtil.hexToBuf(x.buyerAddress)),
      sales.map((x) => dbUtil.hexToBuf(x.sellerAddress)),
      sales.map((x) => prepCurrency(x.currencyContract)),
    ]
  );
}

async function aggregateSalesByProject({ client, afterDate }) {
  const result = await client.query(
    `
    SELECT
      sum(price) AS sum,
      projects.project_id AS "projectId",
      min(slug) AS slug
    FROM opensea_sales
    JOIN tokens
      ON
        opensea_sales.token_id = tokens.on_chain_token_id AND
        opensea_sales.token_contract = tokens.token_contract
    JOIN projects
      ON tokens.project_id = projects.project_id
    WHERE sale_time >= $1 AND
      (currency_contract IS NULL OR currency_contract = $2)
    GROUP BY projects.project_id
    ORDER BY sum(price) DESC
    `,
    [afterDate, dbUtil.hexToBuf(WETH_ADDRESS)]
  );
  return result.rows.map((x) => ({
    slug: x.slug,
    projectId: x.projectId,
    totalEthSales: BigInt(x.sum),
  }));
}

async function salesForToken({ client, tokenContract, tokenId }) {
  const result = await client.query(
    `
    SELECT
      event_id AS "eventId",
      token_id AS "tokenId",
      sale_time AS "saleTime",
      token_contract,
      currency_contract,
      price,
      buyer_address,
      seller_address
    FROM opensea_sales
    WHERE token_contract = $1 AND token_id = $2
    ORDER BY sale_time ASC
    `,
    [dbUtil.hexToBuf(tokenContract), tokenId]
  );
  return result.rows.map((x) => ({
    eventId: x.eventId,
    tokenId: x.tokenId,
    saleTime: x.saleTime,
    price: BigInt(x.price),
    tokenContract: dbUtil.bufToHex(x.token_contract),
    sellerAddress: dbUtil.bufToHex(x.seller_address),
    buyerAddress: dbUtil.bufToHex(x.buyer_address),
    currencyContract: unprepCurrency(x.currency_contract),
  }));
}

const prepCurrency = (x) =>
  x === "0x0000000000000000000000000000000000000000"
    ? null
    : dbUtil.hexToBuf(x);
const unprepCurrency = (x) =>
  x == null ? "0x0000000000000000000000000000000000000000" : dbUtil.bufToHex(x);

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

module.exports = {
  addSales,
  aggregateSalesByProject,
  salesForToken,
  WETH_ADDRESS,
  processSales,
};
