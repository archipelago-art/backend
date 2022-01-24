const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");
const slug = require("../util/slugify");
const events = require("./events");
const { ObjectType, newId, newIds } = require("./id");
const { hexToBuf, bufToAddress } = require("./util");

const PROJECT_STRIDE = 1e6;

const CONTRACT_ARTBLOCKS_LEGACY = "0x059EDD72Cd353dF5106D2B9cC5ab83a52287aC3a";
const CONTRACT_ARTBLOCKS_STANDARD =
  "0xa7d8d9ef8D8Ce8992Df33D8b8CF4Aebabd5bD270";
// Projects below this threshold are legacy, at or above are standard.
const ARTBLOCKS_CONTRACT_THRESHOLD = 3;

function artblocksContractAddress(projectId) {
  return projectId < ARTBLOCKS_CONTRACT_THRESHOLD
    ? CONTRACT_ARTBLOCKS_LEGACY
    : CONTRACT_ARTBLOCKS_STANDARD;
}

// Event payloads are JSON `{ projectId: string, tokenId: string }`.
const newTokensChannel = events.channel("new_tokens");

// Event payloads are JSON `{ projectId: string, completedThroughTokenIndex: number }`.
const imageProgressChannel = events.channel("image_progress");

function tokenBounds(projectId) {
  const minTokenId = projectId * PROJECT_STRIDE;
  const maxTokenId = minTokenId + PROJECT_STRIDE;
  return { minTokenId, maxTokenId };
}

async function addProject({ client, project, slugOverride }) {
  if (typeof project.scriptJson !== "string") {
    throw new Error(
      "project.scriptJson should be a raw JSON string; got: " +
        JSON.stringify(project)
    );
  }
  const rawAspectRatio = JSON.parse(project.scriptJson).aspectRatio;
  const aspectRatio = normalizeAspectRatio(rawAspectRatio);
  await client.query("BEGIN");
  const projectIdRes = await client.query(
    `
    SELECT project_id AS id FROM artblocks_projects
    WHERE artblocks_project_index = $1
    `,
    [project.projectId]
  );
  const projectId =
    projectIdRes.rows.length > 0
      ? projectIdRes.rows[0].id
      : newId(ObjectType.PROJECT);
  await client.query(
    `
    INSERT INTO projects (
      project_id,
      name,
      max_invocations,
      artist_name,
      description,
      script_json,
      aspect_ratio,
      num_tokens,
      slug,
      script,
      token_contract
    )
    SELECT
      $1::projectid,
      $2, $3, $4, $5, $6, $7,
      0,  -- no tokens to start: tokens must be added after project
      $8, $9, $10
    ON CONFLICT (project_id) DO UPDATE SET
      name = $2,
      max_invocations = $3,
      artist_name = $4,
      description = $5,
      script_json = $6,
      aspect_ratio = $7,
      slug = $8,
      script = $9,
      token_contract = $10
    `,
    [
      projectId,
      project.name,
      project.maxInvocations,
      project.artistName,
      project.description,
      project.scriptJson,
      aspectRatio,
      slugOverride ?? slug(project.name),
      project.script,
      hexToBuf(artblocksContractAddress(project.projectId)),
    ]
  );
  await client.query(
    `
    INSERT INTO artblocks_projects (project_id, artblocks_project_index)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    `,
    [projectId, project.projectId]
  );
  await client.query("COMMIT");
  return projectId;
}

async function projectIdsFromArtblocksIndices({ client, indices }) {
  const res = await client.query(
    `
    SELECT project_id AS "id"
    FROM unnest($1::int[]) WITH ORDINALITY AS inputs(artblocks_project_index, i)
    LEFT OUTER JOIN artblocks_projects USING (artblocks_project_index)
    ORDER BY i
    `,
    [indices]
  );
  return res.rows.map((r) => r.id);
}

async function artblocksProjectIndicesFromIds({ client, projectIds }) {
  const res = await client.query(
    `
    SELECT artblocks_project_index AS "idx"
    FROM unnest($1::projectid[]) WITH ORDINALITY AS inputs(project_id, i)
    LEFT OUTER JOIN artblocks_projects USING (project_id)
    ORDER BY i
    `,
    [projectIds]
  );
  return res.rows.map((r) => r.idx);
}

async function setProjectSlug({ client, projectId, slug }) {
  if (typeof slug !== "string") {
    throw new Error(
      "new slug should be a string, but got: " + JSON.stringify(project)
    );
  }
  const res = await client.query(
    `
    UPDATE projects SET slug = $2 WHERE project_id = $1
    `,
    [projectId, slug]
  );
  if (res.rowCount === 0)
    throw new Error("no project found by ID " + projectId);
}

async function getProjectIdBySlug({ client, slug }) {
  const res = await client.query(
    `
    SELECT project_id AS id FROM projects
    WHERE slug = $1
    `,
    [slug]
  );
  if (res.rowCount === 0) {
    return null;
  }
  return res.rows[0].id;
}

async function addToken({ client, artblocksTokenId, rawTokenData }) {
  if (rawTokenData == null) {
    throw new Error("no token data given");
  }
  await client.query("BEGIN");
  const tokenId = newId(ObjectType.TOKEN);
  const artblocksProjectIndex = Math.floor(artblocksTokenId / PROJECT_STRIDE);
  const projectIdRes = await client.query(
    `
    SELECT project_id AS id FROM artblocks_projects
    WHERE artblocks_project_index = $1
    `,
    [artblocksProjectIndex]
  );
  if (projectIdRes.rows.length !== 1) {
    throw new Error(
      `expected project ${artblocksProjectIndex} to exist for token ${artblocksTokenId}`
    );
  }
  const projectId = projectIdRes.rows[0].id;
  const updateProjectsRes = await client.query(
    `
    UPDATE projects
    SET num_tokens = num_tokens + 1
    WHERE project_id = $1
    `,
    [projectId]
  );
  await client.query(
    `
    INSERT INTO tokens (
      token_id,
      project_id,
      token_index,
      token_contract,
      on_chain_token_id,
      fetch_time,
      token_data
    )
    VALUES (
      $1, $2, $3,
      (SELECT token_contract FROM projects WHERE project_id = $2::projectid),
      $4, now(), $5
    )
    `,
    [
      tokenId,
      projectId,
      artblocksTokenId % PROJECT_STRIDE,
      artblocksTokenId,
      rawTokenData,
    ]
  );
  await populateTraitMembers({
    client,
    tokenId,
    projectId,
    rawTokenData,
  });
  await newTokensChannel.send(client, { projectId, tokenId });
  await client.query("COMMIT");
  return tokenId;
}

async function populateTraitMembers({
  client,
  tokenId,
  projectId,
  rawTokenData,
}) {
  const featureData = JSON.parse(rawTokenData).features;
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
  const traitValues = featureIdsRes.rows.map((r) =>
    JSON.stringify(featureData[r.name])
  );

  await client.query(
    `
    INSERT INTO traits (feature_id, trait_id, value)
    VALUES (
      unnest($1::featureid[]),
      unnest($2::traitid[]),
      unnest($3::jsonb[])
    )
    ON CONFLICT (feature_id, value) DO NOTHING
    `,
    [featureIds, newIds(traitValues.length, ObjectType.TRAIT), traitValues]
  );

  await client.query(
    `
    INSERT INTO trait_members (trait_id, token_id)
    SELECT trait_id, $1::tokenid
    FROM traits
    JOIN unnest($2::featureid[], $3::jsonb[]) AS my_traits(feature_id, value)
      USING (feature_id, value)
    ON CONFLICT DO NOTHING
    `,
    [tokenId, featureIds, traitValues]
  );
}

async function updateTokenData({ client, tokenId, rawTokenData }) {
  if (rawTokenData == null) {
    throw new Error("can't update token data to become missing");
  }
  await client.query("BEGIN");
  const updateRes = await client.query(
    `
    UPDATE tokens
    SET fetch_time = now(), token_data = $2
    WHERE token_id = $1
    RETURNING project_id AS "projectId"
    `,
    [tokenId, rawTokenData]
  );
  if (updateRes.rowCount !== 1) {
    throw new Error("no token with ID " + tokenId);
  }
  const projectId = updateRes.rows[0].projectId;
  await client.query(
    `
    DELETE FROM trait_members
    WHERE token_id = $1
    `,
    [tokenId]
  );
  await populateTraitMembers({
    client,
    tokenId,
    projectId,
    rawTokenData,
  });
  await client.query("COMMIT");
}

/*
 * type Trait = {
 *   traitId: string,
 *   value: Json,
 *   tokenIndices: integer[],
 * }
 *
 * type Feature = {
 *   featureId: string,
 *   name: string,
 *   traits: Trait[],
 * }
 *
 * returns Feature[]
 */
async function getProjectFeaturesAndTraits({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      features.feature_id AS "featureId",
      name,
      traits.trait_id AS "traitId",
      value,
      array_agg(token_index ORDER BY token_index) AS "tokenIndices"
    FROM features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
      JOIN tokens USING (token_id)
    WHERE features.project_id = $1
    GROUP BY
      feature_id, trait_id,
      features.name, traits.value  -- functionally dependent
    ORDER BY name, value
    `,
    [projectId]
  );

  const result = [];
  let currentFeature = {};
  for (const row of res.rows) {
    if (currentFeature.featureId !== row.featureId) {
      currentFeature = {
        featureId: row.featureId,
        name: row.name,
        traits: [],
      };
      result.push(currentFeature);
    }
    currentFeature.traits.push({
      traitId: row.traitId,
      value: row.value,
      tokenIndices: row.tokenIndices,
    });
  }
  return result;
}

async function getAllFeaturesAndTraitsOnly({ client }) {
  const res = await client.query(
    `
    SELECT
      projects.slug AS "projectSlug",
      features.name AS "featureName",
      jsonb_agg(traits.value ORDER BY traits.value->>0) AS "traitValues"
    FROM
      projects
      JOIN features USING (project_id)
      JOIN traits USING (feature_id)
    GROUP BY projects.project_id, features.feature_id
    ORDER BY projects.project_id, features.feature_id
    `
  );
  return res.rows;
}

/**
 * Finds distinct traits for the same feature that have the same value after
 * JSON stringification: e.g., `"0"` vs `0`, or `"null"` vs `null`. Returns all
 * token IDs with any of these traits.
 */
async function findSuspiciousTraits({ client }) {
  const res = await client.query(
    `
    SELECT DISTINCT token_id AS "tokenId"
    FROM (
      SELECT trait_id
      FROM traits
      JOIN (
        SELECT feature_id, value->>0 AS value_string
        FROM traits
        WHERE EXISTS (
          SELECT 1 FROM trait_members
          WHERE trait_members.trait_id = traits.trait_id
        )
        GROUP BY feature_id, value->>0
        HAVING count(1) > 1
      ) AS q
      ON traits.feature_id = q.feature_id AND traits.value->>0 = q.value_string
    ) AS suspicious_traits
    JOIN trait_members USING (trait_id)
    ORDER BY token_id
    `
  );
  return res.rows.map((r) => r.tokenId);
}

/**
 * Finds tokens that have no traits even though other tokends within their
 * project do have traits.
 *
 * This can indicate one of two things: either
 *
 *   - we ingested the token too early, before the Art Blocks API had populated
 *     trait data; or
 *   - the Art Blocks API is persistently claiming that such tokens have no
 *     traits, either correctly or not.
 *
 * Results are given as on-chain IDs for easy fetching.
 */
async function findSuspiciousTraitlessTokens({ client }) {
  const res = await client.query(
    `
    SELECT token_id AS "tokenId"
    FROM tokens
    JOIN (
      SELECT
        project_id,
        count(CASE WHEN num_traits = 0 THEN 1 END) AS num_zero,
        count(CASE WHEN num_traits > 0 THEN 1 END) AS num_nonzero
      FROM (
        SELECT project_id, count(trait_id) AS num_traits
        FROM tokens LEFT OUTER JOIN trait_members USING (token_id)
        GROUP BY token_id
      ) AS token_trait_counts_by_project
      GROUP BY project_id
    ) AS project_trait_count_distributions USING (project_id)
    LEFT OUTER JOIN trait_members USING (token_id)
    WHERE
      num_zero > 0 AND num_nonzero > 0
      AND trait_id IS NULL 
    ORDER BY token_contract, on_chain_token_id
    `
  );
  return res.rows.map((r) => r.tokenId);
}

async function getArtblocksTokenIds({ client, tokenIds }) {
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      artblocks_project_index * 1000000 + token_index AS "artblocksTokenId"
    FROM tokens JOIN artblocks_projects USING (project_id)
    WHERE token_id = ANY($1::tokenid[])
    `,
    [tokenIds]
  );
  return res.rows;
}

/**
 * Deletes traits that have no members and features that have no traits. Traits
 * and features are populated lazily, so this should only happen if token data
 * is updated such that traits/features become orphaned.
 */
async function pruneEmptyFeaturesAndTraits({ client }) {
  const res = await client.query(
    `
    DELETE FROM traits
    WHERE NOT EXISTS (
      SELECT 1 FROM trait_members
      WHERE trait_members.trait_id = traits.trait_id
    );
    DELETE FROM features
    WHERE NOT EXISTS (
      SELECT 1 FROM traits
      WHERE features.feature_id = features.feature_id
    );
    `
  );
  return { traits: res[0].rowCount, features: res[1].rowCount };
}

async function getTokenFeaturesAndTraits({
  client,
  tokenId,
  projectId,
  minTokenIndex,
  maxTokenIndex,
}) {
  if (tokenId == null && projectId == null) {
    throw new Error("must filter by either project ID or token ID");
  }
  const res = await client.query(
    `
    SELECT
      tokens.token_id AS "tokenId",
      token_index AS "tokenIndex",
      features.feature_id AS "featureId",
      name,
      traits.trait_id AS "traitId",
      value
    FROM
      features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
      RIGHT OUTER JOIN tokens USING (token_id)
    WHERE true
      AND (tokens.token_id = $1 OR $1 IS NULL)
      AND (
        tokens.project_id = $2 OR $2 IS NULL
        OR tokens.project_id IS NULL  -- OUTER JOIN
      )
      AND (token_index >= $3 OR $3 IS NULL)
      AND (token_index <= $4 OR $4 IS NULL)
    ORDER BY
      tokens.token_contract,
      tokens.on_chain_token_id,
      feature_id,
      trait_id
    `,
    [tokenId, projectId, minTokenIndex, maxTokenIndex]
  );

  const result = [];
  let currentToken = {};
  for (const row of res.rows) {
    if (currentToken.tokenId !== row.tokenId) {
      currentToken = {
        tokenId: row.tokenId,
        tokenIndex: row.tokenIndex,
        traits: [],
      };
      result.push(currentToken);
    }
    if (row.traitId == null) continue; // OUTER JOIN
    currentToken.traits.push({
      featureId: row.featureId,
      name: row.name,
      traitId: row.traitId,
      value: row.value,
    });
  }
  return result;
}

async function getUnfetchedTokens({
  client,
  projectId /* optional; omit to scan all projects */,
}) {
  const res = await client.query(
    `
    SELECT project_id AS "projectId", token_index AS "tokenIndex"
    FROM (
      SELECT project_id, token_index
      FROM
        projects,
        LATERAL generate_series(0, max_invocations - 1) AS token_index
    ) AS q
    LEFT OUTER JOIN tokens USING (project_id, token_index)
    WHERE
      token_data IS NULL  -- either no "tokens" row or failed fetch
      AND (project_id = $1 OR $1 IS NULL)
    ORDER BY project_id, token_index
    `,
    [projectId]
  );
  return res.rows;
}

async function getTokenImageData({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      artblocks_project_index * $1 + token_index AS "tokenId",
      project_id AS "projectId",
      token_data->'image' AS "imageUrl",
      token_data->'token_hash' AS "tokenHash"
    FROM tokens JOIN artblocks_projects USING (project_id)
    WHERE project_id = $2 OR $2 IS NULL
    ORDER BY artblocks_project_index, token_index
    `,
    [PROJECT_STRIDE, projectId]
  );
  return res.rows;
}

async function getTokenSummaries({ client, tokens }) {
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      name,
      artist_name AS "artistName",
      slug,
      artblocks_project_index AS "artblocksProjectIndex",
      token_index AS "tokenIndex",
      aspect_ratio AS "aspectRatio"
    FROM tokens
    JOIN
      unnest($1::address[], $2::uint256[])
      AS needles(token_contract, on_chain_token_id)
      USING (token_contract, on_chain_token_id)
    JOIN projects USING (project_id)
    LEFT OUTER JOIN artblocks_projects USING (project_id)
    ORDER BY tokens.token_contract, tokens.on_chain_token_id
    `,
    [tokens.map((t) => hexToBuf(t.address)), tokens.map((t) => t.tokenId)]
  );
  return res.rows;
}

async function getProjectScript({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      script,
      script_json->>'type' AS library,
      aspect_ratio AS "aspectRatio"
    FROM projects
    WHERE project_id = $1
    `,
    [projectId]
  );
  return res.rows[0] ?? null;
}

async function getAllProjectScripts({ client }) {
  const res = await client.query(`
    SELECT
      project_id AS "projectId",
      script,
      script_json->>'type' AS library,
      aspect_ratio AS "aspectRatio"
    FROM projects
    ORDER BY project_id ASC
  `);
  return res.rows;
}

async function getTokenHash({ client, slug, tokenIndex }) {
  const res = await client.query(
    `
    SELECT token_data->>'token_hash' AS hash
    FROM projects JOIN tokens USING (project_id)
    WHERE slug = $1 AND token_index = $2
    `,
    [slug, tokenIndex]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].hash;
}

async function getImageProgress({ client }) {
  const res = await client.query(`
    SELECT
      project_id AS "projectId",
      completed_through_token_index AS "completedThroughTokenIndex"
    FROM image_progress
    ORDER BY project_id ASC
  `);
  return res.rows;
}

// Insert-or-update each given progress event. `progress` should be an array of
// objects with fields:
//
//   - projectId: string
//   - completedThroughTokenIndex: number
//
// notifications along `imageProgressChannel` for changes that are not no-ops.
async function updateImageProgress({ client, progress }) {
  const projectIds = progress.map((x) => x.projectId);
  const progressIndices = progress.map((x) => x.completedThroughTokenIndex);
  await client.query("BEGIN");
  const updatesRes = await client.query(
    `
    UPDATE image_progress
    SET
      completed_through_token_index = updates.completed_through_token_index
    FROM
      unnest($1::projectid[], $2::int[])
      AS updates(project_id, completed_through_token_index)
    WHERE
      image_progress.project_id = updates.project_id
      AND (
        -- only send NOTIFY events when necessary
        image_progress.completed_through_token_index
          IS DISTINCT FROM updates.completed_through_token_index
      )
    RETURNING
      updates.project_id AS "projectId",
      updates.completed_through_token_index AS "completedThroughTokenIndex"
    `,
    [projectIds, progressIndices]
  );
  const insertsRes = await client.query(
    `
    INSERT INTO image_progress (
      project_id,
      completed_through_token_index
    )
    SELECT project_id, completed_through_token_index
    FROM
      unnest($1::projectid[], $2::int[])
      AS updates(project_id, completed_through_token_index)
    ON CONFLICT DO NOTHING
    RETURNING
      project_id AS "projectId",
      completed_through_token_index AS "completedThroughTokenIndex"
    `,
    [projectIds, progressIndices]
  );
  const changes = [...updatesRes.rows, ...insertsRes.rows];
  await imageProgressChannel.sendMany(client, changes);
  await client.query("COMMIT");
}

async function getProjectIndices({ client }) {
  const res = await client.query(
    `
    SELECT artblocks_project_index AS "artblocksProjectIndex",
      project_id AS "projectId"
    FROM artblocks_projects
    ORDER BY artblocks_project_index
    `
  );
  return res.rows;
}

module.exports = {
  CONTRACT_ARTBLOCKS_LEGACY,
  CONTRACT_ARTBLOCKS_STANDARD,
  ARTBLOCKS_CONTRACT_THRESHOLD,
  PROJECT_STRIDE,
  newTokensChannel,
  imageProgressChannel,
  addProject,
  projectIdsFromArtblocksIndices,
  artblocksProjectIndicesFromIds,
  setProjectSlug,
  getProjectIdBySlug,
  addToken,
  updateTokenData,
  getProjectFeaturesAndTraits,
  getAllFeaturesAndTraitsOnly,
  findSuspiciousTraits,
  findSuspiciousTraitlessTokens,
  getArtblocksTokenIds,
  pruneEmptyFeaturesAndTraits,
  getTokenFeaturesAndTraits,
  getUnfetchedTokens,
  getTokenImageData,
  getTokenSummaries,
  getProjectScript,
  getAllProjectScripts,
  getTokenHash,
  getImageProgress,
  updateImageProgress,
  getProjectIndices,
};
