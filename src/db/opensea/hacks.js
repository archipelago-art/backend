const { bufToHex } = require("../util");
const wellKnownCurrencies = require("../wellKnownCurrencies");
const { _findOwners } = require("./api");

async function floorAsksByProject({
  client,
  projectIds = null,
  limitEach = 5,
}) {
  await client.query("BEGIN");
  await _findOwners({ client, projectIds });
  const res = await client.query(
    `
    SELECT
      tokens.project_id AS "projectId",
      token_rank AS "tokenRank",
      token_id AS "tokenId",
      tokens.token_contract AS "tokenContract",
      on_chain_token_id AS "onChainTokenId",
      token_index AS "tokenIndex",
      slug
    FROM (
      SELECT
        project_id,
        token_id,
        row_number() OVER (
          PARTITION BY project_id
          ORDER BY min_order_rank
        ) AS token_rank
      FROM (
        SELECT project_id, token_id, min(order_rank) AS min_order_rank
        FROM (
          SELECT
            project_id,
            token_id,
            row_number() OVER (
              PARTITION BY project_id
              ORDER BY price ASC, token_id
            ) AS order_rank
          FROM opensea_asks JOIN token_owners USING (token_id)
          WHERE
            active
            AND (expiration_time IS NULL OR expiration_time > now())
            AND currency_id = $2
            AND project_id = ANY($1::projectid[]) OR $1 IS NULL
            AND seller_address = owner
        ) q
        GROUP BY project_id, token_id
      ) q
    ) q
    JOIN tokens USING (token_id)
    JOIN projects ON (tokens.project_id = projects.project_id)
    WHERE token_rank <= $3
    ORDER BY tokens.project_id, token_rank, token_id
    `,
    [projectIds, wellKnownCurrencies.eth.currencyId, limitEach]
  );
  await client.query("ROLLBACK");
  return res.rows.map((r) => ({
    ...r,
    tokenContract: bufToHex(r.tokenContract),
  }));
}

module.exports = {
  floorAsksByProject,
};
