const channels = require("./channels");
const { hexToBuf } = require("./util");
const { ObjectType, newId } = require("./id");

const newTokensChannel = channels.newTokens;

/**
 * Adds a new token to an existing project without populating any traits. This
 * is collection-agnostic: e.g., it does not do anything Art Blocks-specific.
 * Returns the new token ID.
 */
async function addBareToken({
  client,
  projectId,
  tokenIndex,
  onChainTokenId,
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");

  const updateProjectsRes = await client.query(
    `
    UPDATE projects
    SET num_tokens = num_tokens + 1
    WHERE project_id = $1
    RETURNING slug
    `,
    [projectId]
  );
  if (updateProjectsRes.rowCount === 0) {
    throw new Error("no such project: " + projectId);
  }
  const { slug } = updateProjectsRes.rows[0]; // for new token event

  const tokenId = newId(ObjectType.TOKEN);
  await client.query(
    `
    INSERT INTO tokens (
      token_id,
      project_id,
      token_index,
      token_contract,
      on_chain_token_id
    )
    VALUES (
      $1, $2, $3,
      (SELECT token_contract FROM projects WHERE project_id = $2::projectid),
      $4
    )
    `,
    [tokenId, projectId, tokenIndex, onChainTokenId]
  );

  const newTokenEvent = { projectId, tokenId, slug, tokenIndex };
  await channels.newTokens.send(client, newTokenEvent);

  if (!alreadyInTransaction) await client.query("COMMIT");

  return tokenId;
}

// tokens is an array of {address, tokenId} objects.
// type TokenSummary = {
//   name: string, // e.g. "Chromie Squiggle"
//   slug: string, // e.g. "chromie-squiggle"
//   imageTemplate: string, // e.g. "{baseUrl}/artbocks/{sz}/0/{hi}/{lo}"
//   tokenIndex: number, // e.g. 7583
//   artistName: string, // e.g. "Snowfro"
//   aspectRatio: number, // e.g. 1.5
// }
async function tokenSummariesByOnChainId({ client, tokens }) {
  const res = await client.query(
    `
    SELECT
      name,
      slug,
      image_template AS "imageTemplate",
      token_index AS "tokenIndex",
      artist_name AS "artistName",
      aspect_ratio AS "aspectRatio"
    FROM tokens
    JOIN
      unnest($1::address[], $2::uint256[])
      AS needles(token_contract, on_chain_token_id)
      USING (token_contract, on_chain_token_id)
    JOIN projects USING (project_id)
    ORDER BY tokens.token_contract, tokens.on_chain_token_id
    `,
    [tokens.map((t) => hexToBuf(t.address)), tokens.map((t) => t.tokenId)]
  );
  return res.rows;
}

async function tokenInfoById({ client, tokenIds }) {
  const res = await client.query(
    `
    SELECT t.token_index as "tokenIndex", t.token_id as "tokenId", p.slug
    FROM tokens t JOIN projects p USING (project_id)
    WHERE token_id = ANY($1::tokenid[])
    ORDER BY token_id
  `,
    [tokenIds]
  );
  return res.rows;
}

module.exports = {
  addBareToken,
  tokenSummariesByOnChainId,
  tokenInfoById,
};
