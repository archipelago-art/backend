const { bufToAddress } = require("./util");

async function projectIdForSlug({ client, slug }) {
  const res = await client.query(
    `
    SELECT project_id AS "projectId"
    FROM projects
    WHERE slug = $1
    `,
    [slug]
  );
  if (res.rows.length === 0) {
    return null;
  }
  return res.rows[0].projectId;
}

async function isProjectFullyMinted({ client, projectId }) {
  const res = await client.query(
    `
    SELECT p.num_tokens >= p.max_invocations as "isFullyMinted"
    FROM projects p
    WHERE p.project_id = $1::projectid
    `,
    [projectId]
  );
  return res.rows[0].isFullyMinted;
}

async function getRarityForProjectTokens({ client, projectId }) {
  const res = await client.query(
    `
    SELECT tr.token_id AS "tokenId",
        t.token_index AS "tokenIndex",
        tr.rarity_rank AS "rarityRank"
    FROM token_rarity tr
    JOIN tokens t USING (token_id)
    WHERE tr.project_id = $1::projectid
    ORDER BY tr.rarity_rank
    `,
    [projectId]
  );
  return res.rows;
}

module.exports = {
  projectIdForSlug,
  isProjectFullyMinted,
  getRarityForProjectTokens,
};
