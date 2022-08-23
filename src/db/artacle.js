// Updates the rarity of a token (pulled from Artacle).
async function updateTokenRarity({
  client,
  updates, // array of {tokenId, rarityRank} objects
}) {
  await client.query(
    `
    WITH updates AS (
      SELECT
        inputs.token_id,
        tokens.project_id,
        inputs.rarity_rank
      FROM unnest($1::tokenid[], $2::int[]) as inputs(token_id, rarity_rank)
      LEFT OUTER JOIN tokens USING (token_id)
    )
    INSERT INTO token_rarity (token_id, project_id, rarity_rank, update_time)
    SELECT token_id, project_id, rarity_rank, now()
    FROM updates
    ON CONFLICT (token_id) DO UPDATE
      SET rarity_rank = excluded.rarity_rank,
      project_id = excluded.project_id,
      update_time = excluded.update_time;
    `,
    [updates.map((x) => x.tokenId), updates.map((x) => x.rarityRank)]
  );
}

async function getRarityForProjectTokens({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      tr.token_id AS "tokenId",
      t.token_index AS "tokenIndex",
      tr.rarity_rank AS "rarityRank"
    FROM token_rarity tr
    JOIN tokens t USING (token_id)
    WHERE tr.project_id = $1::projectid
    ORDER BY tr.rarity_rank, t.token_index
    `,
    [projectId]
  );
  return res.rows;
}

// Note: if a token has rarity rank `null`, then its `numTies` value will be 0
// (it's not considered to be tied even with itself).
async function getTokenRarity({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      tr.rarity_rank AS "rarityRank",
      (SELECT num_tokens FROM projects WHERE project_id = t.project_id) AS "total",
      (
        SELECT count(1)::int
        FROM token_rarity tr2
        WHERE
          tr2.project_id = tr.project_id
          AND tr2.rarity_rank = tr.rarity_rank
      ) AS "numTies"
    FROM token_rarity tr
    JOIN tokens t USING (token_id)
    WHERE token_id = $1::tokenid
    `,
    [tokenId]
  );
  return res.rows[0];
}

module.exports = {
  updateTokenRarity,
  getTokenRarity,
  getRarityForProjectTokens,
};
