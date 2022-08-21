const slugify = require("../util/slugify");
const channels = require("./channels");
const { hexToBuf, bufToAddress } = require("./util");
const { ObjectType, newId, newIds } = require("./id");
const ws = require("./ws");
var format = require("pg-format");

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
    RETURNING slug, token_contract AS "tokenContract"
    `,
    [projectId]
  );
  if (updateProjectsRes.rowCount === 0) {
    throw new Error("no such project: " + projectId);
  }
  // Pluck project metadata for new token event.
  const slug = updateProjectsRes.rows[0].slug;
  const tokenContract = bufToAddress(updateProjectsRes.rows[0].tokenContract);

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
  await client.query(
    `
    INSERT INTO image_ingestion_queue (
      token_id, create_time
    ) VALUES (
      $1, now()
    )
    `,
    [tokenId]
  );

  await channels.newTokens.send(client, { projectId, tokenId });
  const message = {
    type: "TOKEN_MINTED",
    topic: slug,
    data: {
      projectId,
      tokenId,
      slug,
      tokenIndex,
      tokenContract,
      onChainTokenId,
    },
  };
  await ws.sendMessages({ client, messages: [message] });

  // Add the token to the queue of tokens that still need trait data. If we're
  // `alreadyInTransaction` and the caller sets the traits within the same
  // transaction, this queue entry may be cleared before the transaction
  // finishes. This insert shouldn't conflict because we've just added the
  // token, so the foreign key constraint couldn't have been satisfied until
  // now.
  await enqueueTokenTraitsQueueEntries({ client, tokenIds: [tokenId] });

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
  excludeTokenIds = [],
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction)
    throw new Error("must be in transaction to claim queue entries");
  const res = await client.query(
    `
    DELETE FROM token_traits_queue
    WHERE token_id IN (
      SELECT token_id FROM token_traits_queue
      WHERE token_id <> ALL($2::tokenid[])
      ORDER BY create_time ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING token_id AS "tokenId"
    `,
    [limit, excludeTokenIds]
  );
  return res.rows.map((r) => r.tokenId);
}

async function enqueueTokenTraitsQueueEntries({ client, tokenIds }) {
  await client.query(
    `
    INSERT INTO token_traits_queue (token_id, create_time)
    VALUES (unnest($1::tokenid[]), now())
    `,
    [tokenIds]
  );
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

  const tokenMetadataRes = await client.query(
    `
    SELECT
      t.token_index AS "tokenIndex",
      p.project_id AS "projectId",
      p.slug AS "slug"
    FROM tokens t JOIN projects p USING (project_id)
    WHERE token_id = $1::tokenid
    `,
    [tokenId]
  );
  if (tokenMetadataRes.rows.length === 0)
    throw new Error("no such token: " + tokenId);
  const { tokenIndex, projectId, slug } = tokenMetadataRes.rows[0];

  // Get relevant feature IDs, adding new features as necessary.
  if (typeof featureData !== "object" /* arrays are okay */) {
    throw new Error(
      "expected object or array for features; got: " + featureData
    );
  }
  // Arrays `featureNames`, `featureIds`, `traitValues`, and `traitIds`
  // all use the same ordering: i.e., the trait with ID `traitIds[i]`
  // belongs to the feature with ID `featureIds[i]`, etc.
  const featureNames = Object.keys(featureData);
  await client.query(
    `
    INSERT INTO features (project_id, feature_id, name)
    VALUES ($1::projectid, unnest($2::featureid[]), unnest($3::text[]))
    ON CONFLICT (project_id, name) DO NOTHING
    `,
    [projectId, newIds(featureNames.length, ObjectType.FEATURE), featureNames]
  );
  const featureIdsRes = await client.query(
    `
    SELECT feature_id AS "featureId"
    FROM features
    JOIN unnest($2::text[]) WITH ORDINALITY AS inputs(name, i) USING (name)
    WHERE project_id = $1::projectid
    ORDER BY i
    `,
    [projectId, featureNames]
  );
  const featureIds = featureIdsRes.rows.map((r) => r.featureId);

  // Get relevant trait IDs, adding new traits as necessary.
  const traitValues = featureNames.map((name) => {
    const traitValue = featureData[name];
    if (typeof traitValue !== "string") {
      throw new Error(
        `expected string trait value for feature "${name}"; got: ${traitValue}`
      );
    }
    return traitValue;
  });
  await client.query(
    `
    INSERT INTO traits (feature_id, trait_id, value)
    VALUES (unnest($1::featureid[]), unnest($2::traitid[]), unnest($3::text[]))
    ON CONFLICT (feature_id, value) DO NOTHING
    `,
    [featureIds, newIds(traitValues.length, ObjectType.TRAIT), traitValues]
  );
  const traitIdsRes = await client.query(
    `
    SELECT trait_id AS "traitId"
    FROM traits
    JOIN
      unnest($1::featureid[], $2::text[]) WITH ORDINALITY
        AS inputs(feature_id, value, i)
      USING (feature_id, value)
    ORDER BY i
    `,
    [featureIds, traitValues]
  );
  const traitIds = traitIdsRes.rows.map((r) => r.traitId);
  if (traitIds.length !== featureIds.length) {
    throw new Error(`${traitIds.length} != ${featureIds.length}`);
  }

  // Update token traits.
  await client.query("DELETE FROM trait_members WHERE token_id = $1", [
    tokenId,
  ]);
  const insertTraitMembersRes = await client.query(
    `
    INSERT INTO trait_members (token_id, trait_id)
    VALUES ($1::tokenid, unnest($2::traitid[]))
    `,
    [tokenId, traitIds]
  );

  const message = {
    type: "TRAITS_UPDATED",
    topic: slug,
    data: {
      projectId,
      tokenId,
      slug,
      tokenIndex,
      traits: traitIds.map((traitId, i) => {
        const featureId = featureIds[i];
        const featureName = featureNames[i];
        const traitValue = traitValues[i];
        const featureSlug = slugify(featureName);
        const traitSlug = slugify(traitValue);
        return {
          featureId,
          traitId,
          featureName,
          traitValue,
          featureSlug,
          traitSlug,
        };
      }),
    },
  };
  await ws.sendMessages({ client, messages: [message] });

  await client.query(
    `
    INSERT INTO cnf_trait_update_queue (token_id, traits_last_update_time)
    VALUES ($1, now())
    ON CONFLICT (token_id) DO UPDATE SET traits_last_update_time = now()
    `,
    [tokenId]
  );
  await channels.traitsUpdated.send(client, {});

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
      aspect_ratio AS "aspectRatio",
      tokens.token_contract AS "tokenContract",
      on_chain_token_id AS "onChainTokenId"
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
  return res.rows.map((x) => ({
    name: x.name,
    slug: x.slug,
    imageTemplate: x.imageTemplate,
    tokenIndex: x.tokenIndex,
    artistName: x.artistName,
    aspectRatio: x.aspectRatio,
    tokenContract: bufToAddress(x.tokenContract),
    onChainTokenId: x.onChainTokenId,
  }));
}

async function tokenInfoById({ client, tokenIds }) {
  const res = await client.query(
    `
    SELECT t.token_index as "tokenIndex", t.token_id as "tokenId", p.slug, t.rarity_rank as "rarityRank"
    FROM tokens t JOIN projects p USING (project_id)
    WHERE token_id = ANY($1::tokenid[])
    ORDER BY token_id
  `,
    [tokenIds]
  );
  return res.rows;
}

// Updates the rarity of a token (pulled from Artacle).
async function updateTokenRarity({
  client,
  updates /*: [[token_id, rarity_rank], [token_id, rarity_rank], ...] */,
}) {
  const rarityUpdate = await client.query(
    format(
      `
    INSERT INTO token_rarity (token_id, rarity_rank, last_modified) VALUES %L
    ON CONFLICT (token_id) DO UPDATE SET rarity_rank = excluded.rarity_rank, last_modified = now();
    `,
      updates
    ),
    []
  );
}

async function getTokenRarity({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT rarity_rank FROM token_rarity WHERE token_id = $1::tokenid
    `,
    [tokenId]
  );
  return res.rows[0]?.rarityRank;
}

module.exports = {
  addBareToken,
  claimTokenTraitsQueueEntries,
  enqueueTokenTraitsQueueEntries,
  setTokenTraits,
  tokenIdByChainData,
  tokenSummariesByOnChainId,
  tokenInfoById,
  updateTokenRarity,
  getTokenRarity,
};
