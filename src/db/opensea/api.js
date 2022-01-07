const { bufToHex } = require("../util");
const wellKnownCurrencies = require("../wellKnownCurrencies");

/**
 * Gets the lowest-priced active ask for the specified token.
 * Returns null if there is no ask.
 * Only considers asks priced in ETH.
 */
async function askForToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      seller_address AS "sellerAddress",
      listing_time AS "listingTime",
      expiration_time AS "expirationTime",
      price,
      token_id AS "tokenId"
    FROM opensea_asks
    WHERE active AND token_id = $1
    AND (expiration_time IS NULL OR expiration_time > now())
    AND currency_id = $2
    ORDER BY price ASC
    LIMIT 1
    `,
    [tokenId, wellKnownCurrencies.eth.currencyId]
  );
  if (res.rows.length === 0) {
    return null;
  }
  const x = res.rows[0];
  return {
    ...x,
    price: BigInt(x.price),
    sellerAddress: bufToHex(x.sellerAddress),
  };
}

/**
 * Get the floor price for every project as a BigInt in Wei (or null if there are no asks)
 * Returns an object with projectIds as keys and floors as values.
 * Only considers asks priced in ETH.
 */
async function floorAskByProject({ client, projectIds = null }) {
  const res = await client.query(
    `
    SELECT project_id AS "projectId", (
      SELECT price FROM opensea_asks
      WHERE active AND (opensea_asks.project_id = projects.project_id)
      AND (expiration_time IS NULL OR expiration_time > now())
      AND currency_id = $2
      ORDER BY price ASC
      LIMIT 1
    ) AS price
    FROM projects
    WHERE project_id = ANY($1::projectid[]) OR $1 IS NULL
    `,
    [projectIds, wellKnownCurrencies.eth.currencyId]
  );
  const result = {};
  for (const { projectId, price } of res.rows) {
    result[projectId] = price == null ? null : BigInt(price);
  }
  return result;
}

/**
 * Computes aggregate opensea ETH and WETH sales for every project that has had any sales.
 */
async function aggregateSalesByProject({ client, afterDate }) {
  if (afterDate == null) {
    afterDate = new Date(0);
  }
  const res = await client.query(
    `
    SELECT
      sum(price) AS sum,
      project_id AS "projectId"
    FROM opensea_sales
    WHERE transaction_timestamp >= $1 AND
      (currency_id = $2 OR currency_id = $3)
    GROUP BY project_id
    ORDER BY sum(price) DESC
    `,
    [
      afterDate,
      wellKnownCurrencies.eth.currencyId,
      wellKnownCurrencies.weth9.currencyId,
    ]
  );
  return res.rows.map((x) => ({
    projectId: x.projectId,
    totalEthSales: BigInt(x.sum),
  }));
}

module.exports = {
  askForToken,
  floorAskByProject,
  aggregateSalesByProject,
};
