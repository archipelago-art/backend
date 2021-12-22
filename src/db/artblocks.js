const slug = require("slug");

const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");
const events = require("./events");
const { ObjectType, newId } = require("./id");
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

// Event payloads are JSON `{ projectId: number, tokenId: number }`.
const newTokensChannel = events.channel("new_tokens");

// Event payloads are JSON `{ projectId: number, completedThroughTokenId: number }`.
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
  const projectNewidRes = await client.query(
    `
    SELECT project_id AS id FROM artblocks_projects
    WHERE artblocks_project_index = $1
    `,
    [project.projectId]
  );
  const projectNewid =
    projectNewidRes.rows.length > 0
      ? projectNewidRes.rows[0].id
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
      token_contract,
      project_newid
    )
    SELECT
      $1, $2, $3, $4, $5, $6, $7,
      0,  -- no tokens to start: tokens must be added after project
      $8, $9, $10, $11
    ON CONFLICT (project_newid) DO UPDATE SET
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
      project.projectId,
      project.name,
      project.maxInvocations,
      project.artistName,
      project.description,
      project.scriptJson,
      aspectRatio,
      slugOverride ?? slug(project.name),
      project.script,
      hexToBuf(artblocksContractAddress(project.projectId)),
      projectNewid,
    ]
  );
  await client.query(
    `
    INSERT INTO artblocks_projects (project_id, artblocks_project_index)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    `,
    [projectNewid, project.projectId]
  );
  await client.query("COMMIT");
  return String(projectNewid);
}

async function getProject({ client, projectId }) {
  const res = await await client.query(
    `
    SELECT
      project_id AS "projectId",
      project_newid AS "projectNewid",
      name as "name",
      max_invocations AS "maxInvocations",
      artist_name AS "artistName",
      description AS "description",
      script_json AS "scriptJson",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      slug AS "slug",
      script AS "script",
      token_contract AS "tokenContract"
    FROM projects
    WHERE project_id = $1
    `,
    [projectId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  row.tokenContract = bufToAddress(row.tokenContract);
  return row;
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
    SELECT project_newid AS id FROM projects
    WHERE slug = $1
    `,
    [slug]
  );
  if (res.rowCount === 0) {
    return null;
  }
  return res.rows[0].id;
}

async function addToken({ client, tokenId, rawTokenData }) {
  await client.query("BEGIN");
  const tokenNewid = newId(ObjectType.TOKEN);
  const projectId = Math.floor(tokenId / PROJECT_STRIDE);
  const updateProjectsRes = await client.query(
    `
    UPDATE projects
    SET num_tokens = num_tokens + 1
    WHERE project_id = $1
    RETURNING project_newid AS "projectNewid"
    `,
    [projectId]
  );
  if (updateProjectsRes.rowCount !== 1) {
    throw new Error(
      `expected project ${projectId} to exist for token ${tokenId}`
    );
  }
  const projectNewid = updateProjectsRes.rows[0].projectNewid;
  await client.query(
    `
    INSERT INTO tokens (
      token_id,
      fetch_time,
      token_data,
      project_id,
      token_contract,
      on_chain_token_id,
      token_index,
      token_newid,
      project_newid
    )
    VALUES (
      $1::int, $2, $3, $4,
      (SELECT token_contract FROM projects WHERE project_id = $4),
      $1::uint256, $5::int8,
      $6, $7
    )
    `,
    [
      tokenId,
      new Date(),
      rawTokenData,
      projectId,
      tokenId % PROJECT_STRIDE,
      tokenNewid,
      projectNewid,
    ]
  );
  await populateTraitMembers({
    client,
    tokenId,
    tokenNewid,
    projectId,
    projectNewid,
    rawTokenData,
    alreadyInTransaction: true,
  });
  await newTokensChannel.send(client, { projectId, tokenId });
  await client.query("COMMIT");
  return String(tokenNewid);
}

async function populateTraitMembers({
  client,
  tokenId,
  projectId,
  tokenNewid,
  projectNewid,
  rawTokenData,
  alreadyInTransaction = false,
}) {
  if (rawTokenData == null) return;
  if (!alreadyInTransaction) await client.query("BEGIN");
  const featureData = JSON.parse(rawTokenData).features;
  if (typeof featureData !== "object" /* arrays are okay */) {
    throw new Error(
      "expected object or array for features; got: " + featureData
    );
  }
  const featureNames = Object.keys(featureData);
  await client.query(
    `
    INSERT INTO features (project_id, project_newid, name, feature_newid)
    VALUES ($1, $2, unnest($3::text[]), unnest($4::featureid[]))
    ON CONFLICT (project_id, name) DO NOTHING
    `,
    [
      projectId,
      projectNewid,
      featureNames,
      featureNames.map(() => newId(ObjectType.FEATURE)),
    ]
  );
  const featureIdsRes = await client.query(
    `
    SELECT feature_id AS "id", feature_newid AS "newid", name
    FROM features
    WHERE project_id = $1 AND name = ANY($2::text[])
    `,
    [projectId, featureNames]
  );

  const featureIds = featureIdsRes.rows.map((r) => r.id);
  const featureNewids = featureIdsRes.rows.map((r) => r.newid);
  const traitValues = featureIdsRes.rows.map((r) =>
    JSON.stringify(featureData[r.name])
  );

  await client.query(
    `
    INSERT INTO traits (feature_id, feature_newid, value, trait_newid)
    VALUES (
      unnest($1::integer[]),
      unnest($2::featureid[]),
      unnest($3::jsonb[]),
      unnest($4::traitid[])
    )
    ON CONFLICT (feature_id, value) DO NOTHING
    `,
    [
      featureIds,
      featureNewids,
      traitValues,
      traitValues.map(() => newId(ObjectType.TRAIT)),
    ]
  );

  await client.query(
    `
    INSERT INTO trait_members (trait_id, token_id, trait_newid, token_newid, token_contract, on_chain_token_id)
    SELECT
      trait_id,
      $1,
      trait_newid,
      $2,
      (SELECT token_contract FROM tokens WHERE token_id = $1),
      (SELECT on_chain_token_id FROM tokens WHERE token_id = $1)
    FROM traits
    JOIN unnest($3::integer[], $4::jsonb[]) AS my_traits(feature_id, value)
      USING (feature_id, value)
    ON CONFLICT DO NOTHING
    `,
    [tokenId, tokenNewid, featureIds, traitValues]
  );
  if (!alreadyInTransaction) await client.query("COMMIT");
}

/*
 * type Trait = {
 *   id: integer,
 *   value: Json,
 *   tokens: integer[],
 *   tokensOnChain: {address: string, onChainId: string<BigNumber>},
 * }
 *
 * type Feature = {
 *   id: integer,
 *   name: string,
 *   traits: Trait[],
 * }
 *
 * returns Feature[]
 */
async function getProjectFeaturesAndTraits({ client, projectNewid }) {
  const res = await client.query(
    `
    SELECT
      feature_id,
      name,
      trait_id,
      value,
      array_agg(token_id ORDER BY token_id) AS tokens,
      array_agg(token_newid::text ORDER BY token_id) AS "tokenNewids"
    FROM features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
    WHERE project_newid = $1
    GROUP BY feature_id, trait_id
    ORDER BY name, value
    `,
    [projectNewid]
  );

  const result = [];
  let currentFeature = {};
  for (const row of res.rows) {
    if (currentFeature.id !== row.feature_id) {
      currentFeature = { id: row.feature_id, name: row.name, traits: [] };
      result.push(currentFeature);
    }
    currentFeature.traits.push({
      id: row.trait_id,
      value: row.value,
      tokens: row.tokens,
      tokenNewids: row.tokenNewids,
    });
  }
  return result;
}

async function getTokenFeaturesAndTraits({
  client,
  tokenId,
  projectId,
  minTokenId,
  maxTokenId,
}) {
  if (tokenId == null && projectId == null) {
    throw new Error("must filter by either project ID or token ID");
  }
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      tokens.token_newid AS "tokenNewid",
      feature_id AS "featureId",
      features.feature_newid AS "featureNewid",
      name,
      trait_id AS "traitId",
      traits.trait_newid AS "traitNewid",
      value
    FROM
      features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
      RIGHT OUTER JOIN tokens USING (token_id)
    WHERE true
      AND (token_id = $1 OR $1 IS NULL)
      AND (
        tokens.project_id = $2 OR $2 IS NULL
        OR tokens.project_id IS NULL  -- OUTER JOIN
      )
      AND (token_id >= $3 OR $3 IS NULL)
      AND (token_id <= $4 OR $4 IS NULL)
    ORDER BY token_id, feature_id, trait_id
    `,
    [tokenId, projectId, minTokenId, maxTokenId]
  );

  const result = [];
  let currentToken = {};
  for (const row of res.rows) {
    if (currentToken.tokenId !== row.tokenId) {
      currentToken = {
        tokenId: row.tokenId,
        tokenNewid: row.tokenNewid,
        traits: [],
      };
      result.push(currentToken);
    }
    if (row.traitId == null) continue; // OUTER JOIN
    currentToken.traits.push({
      featureId: row.featureId,
      featureNewid: row.featureNewid,
      name: row.name,
      traitId: row.traitId,
      traitNewid: row.traitNewid,
      value: row.value,
    });
  }
  return result;
}

async function getTokenIds({ client }) {
  const res = await client.query(`
    SELECT token_id AS "tokenId"
    FROM tokens
    ORDER BY token_id ASC
  `);
  return res.rows.map((row) => row.tokenId);
}

async function getUnfetchedTokenIds({ client, projectId }) {
  const res = await client.query(
    `
    SELECT token_id AS "tokenId"
    FROM
      generate_series(
        $2::int,
        $2::int + (
          SELECT max_invocations
          FROM projects
          WHERE project_id = $1
        ) - 1
      ) AS token_id
      LEFT OUTER JOIN tokens USING (token_id)
    WHERE token_data IS NULL
    ORDER BY token_id ASC
    `,
    [projectId, projectId * PROJECT_STRIDE]
  );
  return res.rows.map((row) => row.tokenId);
}

async function getAllUnfetchedTokenIds({ client }) {
  const res = await client.query(
    `
    SELECT token_id AS "tokenId"
    FROM
      projects,
      LATERAL generate_series(
        project_id * $1,
        project_id * $1 + max_invocations - 1
      ) AS token_id
      LEFT OUTER JOIN tokens USING (token_id)
    WHERE token_data IS NULL
    ORDER BY token_id ASC
    `,
    [PROJECT_STRIDE]
  );
  return res.rows.map((row) => row.tokenId);
}

async function getTokenImageData({ client }) {
  const res = await client.query(`
    SELECT
      token_id AS "tokenId",
      token_data->'image' AS "imageUrl",
      token_data->'token_hash' AS "tokenHash"
    FROM tokens
    ORDER BY token_id ASC
  `);
  return res.rows;
}

async function getTokenSummaries({ client, tokenIds }) {
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      name,
      artist_name AS "artistName",
      slug,
      aspect_ratio AS "aspectRatio"
    FROM tokens
    JOIN projects USING(project_id)
    WHERE token_id = ANY($1::int[])
    ORDER BY token_id
    `,
    [tokenIds]
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

async function getTokenHash({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT token_data->>'token_hash' AS hash
    FROM tokens
    WHERE token_id = $1
    `,
    [tokenId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].hash;
}

async function getImageProgress({ client }) {
  const res = await client.query(`
    SELECT
      project_id AS "projectId",
      completed_through_token_id AS "completedThroughTokenId"
    FROM image_progress
    ORDER BY project_id ASC
  `);
  return res.rows;
}

// Insert-or-update each given progress event. `progress` should be an array of
// objects like `{ projectId: number, completedThroughTokenId: number }`. Sends
// notifications along `imageProgressChannel` for changes that are not no-ops.
async function updateImageProgress({ client, progress }) {
  const projectIds = progress.map((x) => x.projectId);
  const progressValues = progress.map((x) => x.completedThroughTokenId);
  await client.query("BEGIN");
  const updatesRes = await client.query(
    `
    UPDATE image_progress
    SET completed_through_token_id = updates.completed_through_token_id
    FROM (
      SELECT
        unnest($1::int[]) AS project_id,
        unnest($2::int[]) AS completed_through_token_id
    ) AS updates
    WHERE
      image_progress.project_id = updates.project_id
      AND
        -- only send NOTIFY events when necessary
        image_progress.completed_through_token_id
        IS DISTINCT FROM updates.completed_through_token_id
    RETURNING
      updates.project_id AS "projectId",
      updates.completed_through_token_id AS "completedThroughTokenId"
    `,
    [projectIds, progressValues]
  );
  const insertsRes = await client.query(
    `
    INSERT INTO image_progress (project_id, completed_through_token_id)
    VALUES (unnest($1::integer[]), unnest($2::integer[]))
    ON CONFLICT DO NOTHING
    RETURNING
      project_id AS "projectId",
      completed_through_token_id AS "completedThroughTokenId"
    `,
    [projectIds, progressValues]
  );
  const changes = [...updatesRes.rows, ...insertsRes.rows];
  await imageProgressChannel.sendMany(client, changes);
  await client.query("COMMIT");
}

async function getProjectIndices({ client }) {
  const res = await client.query(
    `
    SELECT artblocks_project_index AS "projectIndex"
    FROM artblocks_projects
    ORDER BY artblocks_project_index
    `
  );
  return res.rows.map((x) => x.projectIndex);
}

module.exports = {
  CONTRACT_ARTBLOCKS_LEGACY,
  CONTRACT_ARTBLOCKS_STANDARD,
  ARTBLOCKS_CONTRACT_THRESHOLD,
  PROJECT_STRIDE,
  newTokensChannel,
  imageProgressChannel,
  addProject,
  getProject,
  setProjectSlug,
  getProjectIdBySlug,
  addToken,
  populateTraitMembers,
  getProjectFeaturesAndTraits,
  getTokenFeaturesAndTraits,
  getTokenIds,
  getUnfetchedTokenIds,
  getAllUnfetchedTokenIds,
  getTokenImageData,
  getTokenSummaries,
  getProjectScript,
  getAllProjectScripts,
  getTokenHash,
  getImageProgress,
  updateImageProgress,
  getProjectIndices,
};
