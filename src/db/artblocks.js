const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");
const slug = require("../util/slugify");
const channels = require("./channels");
const { ObjectType, newId, newIds } = require("./id");
const dbTokens = require("./tokens");
const { hexToBuf, bufToAddress } = require("./util");
const contracts = require("../api/contracts");

const imageProgressChannel = channels.imageProgress;

const PROJECT_STRIDE = 1e6;

const CONTRACT_ARTBLOCKS_LEGACY = contracts.artblocksLegacy.address;
const CONTRACT_ARTBLOCKS_STANDARD = contracts.artblocksStandard.address;
// Projects below this threshold are legacy, at or above are standard.
const ARTBLOCKS_CONTRACT_THRESHOLD = 3;

function artblocksContractAddress(projectId) {
  return projectId < ARTBLOCKS_CONTRACT_THRESHOLD
    ? CONTRACT_ARTBLOCKS_LEGACY
    : CONTRACT_ARTBLOCKS_STANDARD;
}

function tokenBounds(projectId) {
  const minTokenId = projectId * PROJECT_STRIDE;
  const maxTokenId = minTokenId + PROJECT_STRIDE;
  return { minTokenId, maxTokenId };
}

function splitOnChainTokenId(artblocksTokenId) {
  const artblocksProjectIndex = Math.floor(artblocksTokenId / PROJECT_STRIDE);
  const tokenIndex = artblocksTokenId % PROJECT_STRIDE;
  return { artblocksProjectIndex, tokenIndex };
}

async function addProject({
  client,
  project,
  slugOverride,
  tokenContract,
  alreadyInTransaction = false,
}) {
  if (typeof project.scriptJson !== "string") {
    throw new Error(
      "project.scriptJson should be a raw JSON string; got: " +
        JSON.stringify(project)
    );
  }
  const rawAspectRatio = JSON.parse(project.scriptJson).aspectRatio;
  const aspectRatio = normalizeAspectRatio(rawAspectRatio);
  if (!alreadyInTransaction) await client.query("BEGIN");
  const projectIdRes = await client.query(
    `
    SELECT project_id AS id FROM artblocks_projects
    WHERE artblocks_project_index = $1
    AND token_contract = $2
    `,
    [project.projectId, hexToBuf(tokenContract)]
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
      aspect_ratio,
      num_tokens,
      slug,
      token_contract,
      image_template
    )
    SELECT
      $1::projectid,
      $2, $3, $4, $5, $6,
      0,  -- no tokens to start: tokens must be added after project
      $7, $8, $9
    ON CONFLICT (project_id) DO UPDATE SET
      name = $2,
      max_invocations = $3,
      artist_name = $4,
      description = $5,
      aspect_ratio = $6,
      slug = $7,
      token_contract = $8,
      image_template = $9
    `,
    [
      projectId,
      project.name,
      project.maxInvocations,
      project.artistName,
      project.description,
      aspectRatio,
      slugOverride ?? slug(project.name),
      hexToBuf(tokenContract),
      `{baseUrl}/artblocks/{sz}/${project.projectId}/{hi}/{lo}`,
    ]
  );
  await client.query(
    `
    INSERT INTO artblocks_projects (
      project_id,
      artblocks_project_index,
      script_json,
      script,
      token_contract
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (project_id) DO UPDATE SET
      script_json = $3,
      script = $4
    `,
    [
      projectId,
      project.projectId,
      project.scriptJson,
      project.script,
      hexToBuf(tokenContract),
    ]
  );
  if (!alreadyInTransaction) await client.query("COMMIT");
  return projectId;
}

async function projectIdsFromArtblocksSpecs({ client, specs }) {
  const res = await client.query(
    `
    SELECT project_id AS "id"
    FROM unnest($1::int[]) WITH ORDINALITY AS inputs(artblocks_project_index, i)
    JOIN unnest($2::address[]) WITH ORDINALITY AS inputs2(token_contract, i) USING (i)
    LEFT OUTER JOIN artblocks_projects USING (artblocks_project_index, token_contract)
    ORDER BY i
    `,
    [
      specs.map((x) => x.projectIndex),
      specs.map((x) => hexToBuf(x.tokenContract)),
    ]
  );
  return res.rows.map((r) => r.id);
}

async function artblocksProjectSpecsFromIds({ client, projectIds }) {
  const res = await client.query(
    `
    SELECT artblocks_project_index AS "projectIndex", token_contract AS "tokenContract"
    FROM unnest($1::projectid[]) WITH ORDINALITY AS inputs(project_id, i)
    LEFT OUTER JOIN artblocks_projects USING (project_id)
    ORDER BY i
    `,
    [projectIds]
  );
  return res.rows.map((x) => ({
    projectIndex: x.projectIndex,
    tokenContract: bufToAddress(x.tokenContract),
  }));
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

async function addBareToken({
  client,
  artblocksTokenId,
  tokenContract,
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");
  if (tokenContract == null) {
    throw new Error("need tokenContract");
  }

  const { tokenIndex, artblocksProjectIndex } =
    splitOnChainTokenId(artblocksTokenId);

  const projectIdRes = await client.query(
    `
    SELECT project_id AS "projectId"
    FROM artblocks_projects JOIN projects USING (project_id)
    WHERE artblocks_project_index = $1
    AND projects.token_contract = $2
    `,
    [artblocksProjectIndex, hexToBuf(tokenContract)]
  );
  if (projectIdRes.rows.length !== 1) {
    throw new Error(
      `expected project ${tokenContract}-${artblocksProjectIndex} to exist for token ${artblocksTokenId}`
    );
  }
  const { projectId } = projectIdRes.rows[0];
  const tokenId = await dbTokens.addBareToken({
    client,
    projectId,
    tokenIndex,
    onChainTokenId: artblocksTokenId,
    alreadyInTransaction: true,
  });

  if (!alreadyInTransaction) await client.query("COMMIT");
  return {
    tokenId,
    projectId,
    tokenIndex,
    artblocksProjectIndex,
    tokenContract,
  };
}

async function addToken({
  client,
  artblocksTokenId,
  rawTokenData,
  tokenContract,
}) {
  if (rawTokenData == null) {
    throw new Error("no token data given");
  }
  if (tokenContract == null) {
    throw new Error("no token contract given");
  }

  await client.query("BEGIN");
  const { tokenId, projectId } = await addBareToken({
    client,
    artblocksTokenId,
    tokenContract,
    alreadyInTransaction: true,
  });
  await updateTokenData({
    client,
    tokenId,
    rawTokenData,
    alreadyInTransaction: true,
  });
  await client.query("COMMIT");
  return tokenId;
}

async function updateTokenData({
  client,
  tokenId,
  rawTokenData,
  alreadyInTransaction = false,
}) {
  if (rawTokenData == null) {
    throw new Error("can't update token data to become missing");
  }
  if (!alreadyInTransaction) await client.query("BEGIN");
  const updateRes = await client.query(
    `
    INSERT INTO artblocks_tokens (token_id, token_data, fetch_time)
    VALUES ($1::tokenid, $2, now())
    ON CONFLICT (token_id) DO UPDATE SET token_data = $2, fetch_time = now()
    `,
    [tokenId, rawTokenData]
  );
  if (updateRes.rowCount !== 1) {
    throw new Error("issue updating artblocks_tokens for ID " + tokenId);
  }
  const featureData = JSON.parse(rawTokenData).features;
  for (const k of Object.keys(featureData)) {
    // Normalize all values as strings instead of retaining the JSON type data,
    // since Art Blocks can't be trusted to give consistently typed values
    // (e.g., giving JSON `1` for some values and JSON `"1"` for others within
    // the same feature).
    featureData[k] = String(featureData[k]);
  }
  await dbTokens.setTokenTraits({
    client,
    tokenId,
    featureData,
    alreadyInTransaction: true,
  });
  if (!alreadyInTransaction) await client.query("COMMIT");
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

async function getArtblocksTokenIds({ client, tokenIds }) {
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      artblocks_project_index * 1000000 + token_index AS "artblocksTokenId",
      token_contract AS "tokenContract"
    FROM tokens JOIN artblocks_projects USING (project_id)
    WHERE token_id = ANY($1::tokenid[])
    `,
    [tokenIds]
  );
  return res.rows.map((x) => ({
    tokenContract: bufToAddress(x.tokenContract),
    artblocksTokenId: x.artblocksTokenId,
    tokenId: x.tokenId,
  }));
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

async function getProjectTokens({ client, projectId }) {
  if (projectId == null) {
    throw new Error("must filter by project ID");
  }
  const res = await client.query(
    `
    SELECT token_id AS "id" FROM tokens
    WHERE project_id = $1
    `,
    [projectId]
  );
  return res.rows.map((r) => r.id);
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
    LEFT OUTER JOIN artblocks_tokens USING (token_id)
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
      tokens.on_chain_token_id AS "onChainTokenId",
      tokens.project_id AS "projectId",
      artblocks_tokens.token_data->>'token_hash' AS "tokenHash"
    FROM tokens
    JOIN artblocks_projects USING (project_id)
    LEFT OUTER JOIN artblocks_tokens USING (token_id)
    WHERE tokens.project_id = $1::projectid OR $1 IS NULL
    ORDER BY artblocks_projects.artblocks_project_index, tokens.token_index
    `,
    [projectId]
  );
  return res.rows.map((r) => ({
    projectId: r.projectId,
    tokenId: Number(r.onChainTokenId), // return field name is legacy
    tokenHash: r.tokenHash,
    imageUrl: `https://media.artblocks.io/${r.onChainTokenId}.png`,
  }));
}

async function getTokenChainData({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      token_contract AS "tokenContract",
      on_chain_token_id AS "onChainTokenId"
    FROM tokens
    WHERE token_id = $1::tokenid
  `,
    [tokenId]
  );
  if (res.rows.length === 0) throw new Error(`no such token: ${tokenId}`);
  const row = res.rows[0];
  return {
    tokenContract: bufToAddress(row.tokenContract),
    onChainTokenId: row.onChainTokenId,
  };
}

async function getProjectScript({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      script,
      script_json->>'type' AS library,
      aspect_ratio AS "aspectRatio"
    FROM projects JOIN artblocks_projects USING (project_id)
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
    FROM projects JOIN artblocks_projects USING (project_id)
    ORDER BY project_id ASC
  `);
  return res.rows;
}

async function getTokenHash({ client, slug, tokenIndex }) {
  const res = await client.query(
    `
    SELECT token_data->>'token_hash' AS hash
    FROM projects
    JOIN tokens USING (project_id)
    JOIN artblocks_tokens USING (token_id)
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

async function getProjectSpecs({ client }) {
  const res = await client.query(
    `
    SELECT artblocks_project_index AS "projectIndex",
      token_contract AS "tokenContract",
      project_id AS "projectId"
    FROM artblocks_projects
    ORDER BY token_contract, artblocks_project_index
    `
  );
  return res.rows.map((x) => ({
    projectIndex: x.projectIndex,
    tokenContract: bufToAddress(x.tokenContract),
    projectId: x.projectId,
  }));
}

async function getOnChainTokenData({ client }) {
  const res = await client.query(
    `
    SELECT
      token_id AS id,
      token_contract AS contract,
      on_chain_token_id AS octid
    FROM tokens
    ORDER BY token_contract, on_chain_token_id
    `
  );
  return res.rows.map((r) => ({
    tokenId: r.id,
    tokenContract: bufToAddress(r.contract),
    onChainTokenId: r.octid,
  }));
}

module.exports = {
  CONTRACT_ARTBLOCKS_LEGACY,
  CONTRACT_ARTBLOCKS_STANDARD,
  ARTBLOCKS_CONTRACT_THRESHOLD,
  PROJECT_STRIDE,
  imageProgressChannel,
  splitOnChainTokenId,
  addProject,
  projectIdsFromArtblocksSpecs,
  artblocksProjectSpecsFromIds,
  setProjectSlug,
  getProjectIdBySlug,
  addBareToken,
  addToken,
  updateTokenData,
  getProjectFeaturesAndTraits,
  getAllFeaturesAndTraitsOnly,
  getArtblocksTokenIds,
  pruneEmptyFeaturesAndTraits,
  getProjectTokens,
  getTokenFeaturesAndTraits,
  getUnfetchedTokens,
  getTokenImageData,
  getTokenChainData,
  getProjectScript,
  getAllProjectScripts,
  getTokenHash,
  getImageProgress,
  updateImageProgress,
  getProjectSpecs,
  getOnChainTokenData,
  artblocksContractAddress,
};
