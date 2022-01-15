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
    WHERE
      active
      AND token_id = $1
      AND (expiration_time IS NULL OR expiration_time > now())
      AND currency_id = $2
      AND seller_address = (
        SELECT to_address FROM erc_721_transfers
        WHERE token_id = $1
        ORDER BY block_number DESC, log_index DESC
        LIMIT 1
      )
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
    WITH current_owners AS (
      SELECT
        token_id,
        to_address AS current_owner
      FROM (
        SELECT
          token_id,
          row_number() OVER (
            PARTITION BY token_id
            ORDER BY block_number DESC, log_index DESC
          ) AS rank,
          to_address
        FROM erc_721_transfers
        WHERE token_id IN (
          SELECT token_id FROM tokens
          WHERE project_id = ANY($1::projectid[]) OR $1 IS NULL
        )
      ) AS ranked_transfers
      WHERE rank = 1
    )
    SELECT project_id AS "projectId", price
    FROM (
      SELECT project_id FROM projects
      WHERE project_id = ANY($1::projectid[]) OR $1 IS NULL
    ) AS these_projects
    LEFT OUTER JOIN
    (
      SELECT project_id, min(price) AS price
      FROM
        opensea_asks
        JOIN current_owners USING (token_id)
      WHERE
        active
        AND (expiration_time IS NULL OR expiration_time > now())
        AND currency_id = $2
        AND (project_id = ANY($1::projectid[]) OR $1 IS NULL)
        AND current_owner = seller_address
      GROUP BY project_id
      ORDER BY project_id
    ) AS floors
    USING (project_id)
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
 * Get the lowest open ask for each token in a project.
 * Returns an object with tokenIds as keys and BigInt eth prices as values.
 * Only tokenIds that have at least one active ETH-priced ask will be included.
 * If there are multiple open asks for a token, the lowest price is provided.
 */
async function asksForProject({ client, projectId }) {
  const res = await client.query(
    `
    WITH current_owners AS (
      SELECT
        token_id,
        to_address AS current_owner
      FROM (
        SELECT
          token_id,
          row_number() OVER (
            PARTITION BY token_id
            ORDER BY block_number DESC, log_index DESC
          ) AS rank,
          to_address
        FROM erc_721_transfers
        WHERE token_id IN (
          SELECT token_id FROM tokens
          WHERE project_id = $1
        )
      ) AS ranked_transfers
      WHERE rank = 1
    )
    SELECT
      token_id AS id,
      min(price) AS price
    FROM opensea_asks JOIN current_owners USING (token_id)
    WHERE
      active
      AND currency_id = $2
      AND project_id = $1
      AND (expiration_time IS NULL OR expiration_time > now())
      AND seller_address = current_owner
    GROUP BY token_id
    `,
    [projectId, wellKnownCurrencies.eth.currencyId]
  );
  const result = {};
  for (const { id, price } of res.rows) {
    result[id] = BigInt(price);
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
  asksForProject,
};
