const channels = require("./channels");
const { hexToBuf } = require("./util");
const { ObjectType, newId, newIds } = require("./id");

const newTokensChannel = channels.newTokens;
const traitsUpdatedChannel = channels.traitsUpdated;

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

  // Add the token to the queue of tokens that still need trait data. If we're
  // `alreadyInTransaction` and the caller sets the traits within the same
  // transaction, this queue entry may be cleared before the transaction
  // finishes. This insert shouldn't conflict because we've just added the
  // token, so the foreign key constraint couldn't have been satisfied until
  // now.
  await client.query(
    `
    INSERT INTO token_traits_queue (token_id, create_time)
    VALUES ($1::tokenid, now())
    `,
    [tokenId]
  );

  if (!alreadyInTransaction) await client.query("COMMIT");
  return tokenId;
}

/**
 * Removes some unclaimed entries from the token-traits queue. Must be run
 * within a transaction; the caller should fetch trait data, call
 * `setTokenTraits`, and commit the transaction, or else roll back.
 */
async function claimTokenTraitsQueueEntries({
  client,
  limit,
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction)
    throw new Error("must be in transaction to claim queue entries");
  const res = await client.query(
    `
    DELETE FROM token_traits_queue
    WHERE token_id IN (
      SELECT token_id FROM token_traits_queue
      ORDER BY create_time ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING token_id AS "tokenId"
    `,
    [limit]
  );
  return res.rows.map((r) => r.tokenId);
}

/**
 * Set or update traits for a token. `featureData` represents the *entire* new
 * set of traits: i.e., any existing trait memberships not specified here will
 * be deleted.
 */
async function setTokenTraits({
  client,
  tokenId,
  featureData /*: object mapping feature names (strings) to trait values (strings) */,
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");

  const projectIdRes = await client.query(
    'SELECT project_id AS "projectId" FROM tokens WHERE token_id = $1::tokenid',
    [tokenId]
  );
  if (projectIdRes.rows.length === 0)
    throw new Error("no such token: " + tokenId);
  const { projectId } = projectIdRes.rows[0];

  // Get relevant feature IDs, adding new features as necessary.
  if (typeof featureData !== "object" /* arrays are okay */) {
    throw new Error(
      "expected object or array for features; got: " + featureData
    );
  }
  const featureNames = Object.keys(featureData);
  await client.query(
    `
    INSERT INTO features (project_id, feature_id, name)
    VALUES (
      $1::projectid,
      unnest($2::featureid[]),
      unnest($3::text[])
    )
    ON CONFLICT (project_id, name) DO NOTHING
    `,
    [projectId, newIds(featureNames.length, ObjectType.FEATURE), featureNames]
  );
  const featureIdsRes = await client.query(
    `
    SELECT feature_id AS "id", name
    FROM features
    WHERE project_id = $1 AND name = ANY($2::text[])
    `,
    [projectId, featureNames]
  );
  const featureIds = featureIdsRes.rows.map((r) => r.id);

  // Get relevant trait IDs, adding new traits as necessary.
  const traitValues = featureIdsRes.rows.map((r) => {
    const traitValue = featureData[r.name];
    if (typeof traitValue !== "string") {
      throw new Error(
        `expected string trait value for feature "${r.name}"; got: ${traitValue}`
      );
    }
    return traitValue;
  });
  await client.query(
    `
    INSERT INTO traits (feature_id, trait_id, value)
    VALUES (
      unnest($1::featureid[]),
      unnest($2::traitid[]),
      unnest($3::text[])
    )
    ON CONFLICT (feature_id, value) DO NOTHING
    `,
    [featureIds, newIds(traitValues.length, ObjectType.TRAIT), traitValues]
  );

  // Update token traits.
  await client.query("DELETE FROM trait_members WHERE token_id = $1", [
    tokenId,
  ]);
  await client.query(
    `
    INSERT INTO trait_members (trait_id, token_id)
    SELECT trait_id, $1::tokenid
    FROM traits
    JOIN unnest($2::featureid[], $3::text[]) AS my_traits(feature_id, value)
      USING (feature_id, value)
    ON CONFLICT DO NOTHING
    `,
    [tokenId, featureIds, traitValues]
  );

  await client.query(
    `
    INSERT INTO cnf_trait_update_queue (token_id, traits_last_update_time)
    VALUES ($1, now())
    ON CONFLICT (token_id) DO UPDATE SET traits_last_update_time = now()
    `,
    [tokenId]
  );
  await traitsUpdatedChannel.send(client, {});

  // Remove this from the queue of tokens that still need trait data, taking
  // some care to not hang if another transaction is doing the same.
  //
  // Note: if another transaction (T0) has locked this queue entry for
  // deletion, and this transaction (T1) updates the trait data and commits but
  // T0 reverts, then the entry spuriously remain in the queue. This is okay,
  // because it only results in overprocessing, not missing traits.
  await client.query(
    `
    DELETE FROM token_traits_queue
    WHERE token_id = (
      SELECT token_id FROM token_traits_queue
      WHERE token_id = $1::tokenid
      FOR UPDATE SKIP LOCKED
    )
    `,
    [tokenId]
  );
  if (!alreadyInTransaction) await client.query("COMMIT");
}

async function tokenIdByChainData({ client, tokenContract, onChainTokenId }) {
  const res = await client.query(
    `
    SELECT token_id AS "tokenId" FROM tokens
    WHERE token_contract = $1::address AND on_chain_token_id = $2::uint256
    `,
    [hexToBuf(tokenContract), onChainTokenId]
  );
  const row = res.rows[0];
  if (row == null) return null;
  return row.tokenId;
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
  claimTokenTraitsQueueEntries,
  setTokenTraits,
  tokenIdByChainData,
  tokenSummariesByOnChainId,
  tokenInfoById,
};
