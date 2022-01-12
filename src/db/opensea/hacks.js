const { bufToHex } = require("../util");
const wellKnownCurrencies = require("../wellKnownCurrencies");

async function floorAsksByProject({
  client,
  projectIds = null,
  limitEach = 5,
}) {
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
    SELECT
      tokens.project_id AS "projectId",
      token_rank AS "tokenRank",
      token_id AS "tokenId",
      token_contract AS "tokenContract",
      on_chain_token_id AS "onChainTokenId"
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
              ORDER BY price ASC
            ) AS order_rank
          FROM opensea_asks JOIN current_owners USING (token_id)
          WHERE
            active
            AND (expiration_time IS NULL OR expiration_time > now())
            AND currency_id = $2
            AND project_id = ANY($1::projectid[]) OR $1 IS NULL
            AND current_owner = seller_address
        ) q
        GROUP BY project_id, token_id
      ) q
    ) q
    JOIN tokens USING (token_id)
    WHERE token_rank <= $3
    ORDER BY tokens.project_id, token_rank, token_id
    `,
    [projectIds, wellKnownCurrencies.eth.currencyId, limitEach]
  );
  return res.rows.map((r) => ({
    ...r,
    tokenContract: bufToHex(r.tokenContract),
  }));
}

module.exports = {
  floorAsksByProject,
};
