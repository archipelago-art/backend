const { bufToAddress } = require("../util");
const wellKnownCurrencies = require("../wellKnownCurrencies");

async function _findOwners({ client, projectIds, tokenIds }) {
  await client.query(`
    CREATE TEMPORARY TABLE token_owners(
      token_id tokenid PRIMARY KEY,
      owner address NOT NULL
    ) ON COMMIT DROP;
  `);
  await client.query(
    `
    INSERT INTO token_owners(token_id, owner)
    SELECT token_id, to_address
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
        WHERE
          true
          AND (project_id = ANY($1::projectid[]) OR $1 IS NULL)
          AND (token_id = ANY($2::tokenid[]) OR $2 IS NULL)
      )
    ) AS ranked_transfers
    WHERE rank = 1
    `,
    [projectIds, tokenIds]
  );
}

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
    sellerAddress: bufToAddress(x.sellerAddress),
  };
}

/**
 * Get the floor price for every project as a BigInt in Wei (or null if there are no asks)
 * Returns an object with projectIds as keys and floors as values.
 * Only considers asks priced in ETH.
 */
async function floorAskByProject({ client, projectIds = null }) {
  await client.query("BEGIN");
  await _findOwners({ client, projectIds });
  const res = await client.query(
    `
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
        JOIN token_owners USING (token_id)
      WHERE
        active
        AND (expiration_time IS NULL OR expiration_time > now())
        AND currency_id = $2
        AND (project_id = ANY($1::projectid[]) OR $1 IS NULL)
        AND seller_address = owner
      GROUP BY project_id
      ORDER BY project_id
    ) AS floors
    USING (project_id)
    `,
    [projectIds, wellKnownCurrencies.eth.currencyId]
  );
  await client.query("ROLLBACK");
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
  await client.query("BEGIN");
  await _findOwners({ client, projectIds: [projectId] });
  const res = await client.query(
    `
    SELECT
      token_id AS id,
      min(price) AS price
    FROM opensea_asks JOIN token_owners USING (token_id)
    WHERE
      active
      AND currency_id = $2
      AND project_id = $1
      AND (expiration_time IS NULL OR expiration_time > now())
      AND seller_address = owner
    GROUP BY token_id
    `,
    [projectId, wellKnownCurrencies.eth.currencyId]
  );
  await client.query("ROLLBACK");
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

async function salesByToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      seller_address AS "from",
      buyer_address AS "to",
      transaction_timestamp AS "timestamp",
      transaction_hash AS "transactionHash",
      price AS "priceWei"
    FROM opensea_sales
    WHERE token_id = $1::tokenid AND currency_id IN ($2, $3)
    ORDER BY transaction_timestamp, transaction_hash, event_id
    `,
    [
      tokenId,
      wellKnownCurrencies.eth.currencyId,
      wellKnownCurrencies.weth9.currencyId,
    ]
  );
  return res.rows.map((r) => ({
    from: bufToAddress(r.from),
    to: bufToAddress(r.to),
    timestamp: r.timestamp,
    transactionHash: r.transactionHash,
    priceWei: r.priceWei,
  }));
}

module.exports = {
  _findOwners,
  askForToken,
  floorAskByProject,
  aggregateSalesByProject,
  asksForProject,
  salesByToken,
};
