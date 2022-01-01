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

// Event payloads are JSON `{ projectId: string, tokenId: string }` (these are "newids").
const newTokensChannel = events.channel("new_tokens");

// Event payloads are JSON `{ projectId: string, completedThroughTokenIndex: number }` (a newid string).
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
  return projectNewid;
}

async function getProject({ client, projectNewid }) {
  const res = await await client.query(
    `
    SELECT
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
    WHERE project_newid = $1
    `,
    [projectNewid]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  row.tokenContract = bufToAddress(row.tokenContract);
  return row;
}

async function projectNewidsFromArtblocksIndices({ client, indices }) {
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

async function setProjectSlug({ client, projectNewid, slug }) {
  if (typeof slug !== "string") {
    throw new Error(
      "new slug should be a string, but got: " + JSON.stringify(project)
    );
  }
  const res = await client.query(
    `
    UPDATE projects SET slug = $2 WHERE project_newid = $1
    `,
    [projectNewid, slug]
  );
  if (res.rowCount === 0)
    throw new Error("no project found by ID " + projectNewid);
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
  const artblocksProjectIndex = Math.floor(tokenId / PROJECT_STRIDE);
  const projectNewidRes = await client.query(
    `
    SELECT project_id AS id FROM artblocks_projects
    WHERE artblocks_project_index = $1
    `,
    [artblocksProjectIndex]
  );
  if (projectNewidRes.rows.length !== 1) {
    throw new Error(
      `expected project ${projectId} to exist for token ${tokenId}`
    );
  }
  const projectNewid = projectNewidRes.rows[0].id;
  const updateProjectsRes = await client.query(
    `
    UPDATE projects
    SET num_tokens = num_tokens + 1
    WHERE project_newid = $1
    `,
    [projectNewid]
  );
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
      (SELECT token_contract FROM projects WHERE project_newid = $7),
      $1::uint256, $5::int8,
      $6, $7
    )
    `,
    [
      tokenId,
      new Date(),
      rawTokenData,
      artblocksProjectIndex,
      tokenId % PROJECT_STRIDE,
      tokenNewid,
      projectNewid,
    ]
  );
  await populateTraitMembers({
    client,
    tokenId,
    tokenNewid,
    projectId: artblocksProjectIndex,
    projectNewid,
    rawTokenData,
    alreadyInTransaction: true,
  });
  await newTokensChannel.send(client, {
    projectId: projectNewid,
    tokenId: tokenNewid,
  });
  await client.query("COMMIT");
  return tokenNewid;
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
    INSERT INTO features (project_id, feature_id, name)
    VALUES (
      $1::projectid,
      unnest($2::featureid[]),
      unnest($3::text[])
    )
    ON CONFLICT (project_id, name) DO NOTHING
    `,
    [
      projectNewid,
      newIds(featureNames.length, ObjectType.FEATURE),
      featureNames,
    ]
  );
  const featureIdsRes = await client.query(
    `
    SELECT feature_id AS "id", name
    FROM features
    WHERE project_id = $1 AND name = ANY($2::text[])
    `,
    [projectNewid, featureNames]
  );

  const featureNewids = featureIdsRes.rows.map((r) => r.id);
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
    [featureNewids, newIds(traitValues.length, ObjectType.TRAIT), traitValues]
  );

  await client.query(
    `
    INSERT INTO trait_members (trait_id, token_id, token_newid, token_contract, on_chain_token_id)
    SELECT
      trait_id,
      $1,
      $2,
      (SELECT token_contract FROM tokens WHERE token_id = $1),
      (SELECT on_chain_token_id FROM tokens WHERE token_id = $1)
    FROM traits
    JOIN unnest($3::featureid[], $4::jsonb[]) AS my_traits(feature_id, value)
      USING (feature_id, value)
    ON CONFLICT DO NOTHING
    `,
    [tokenId, tokenNewid, featureNewids, traitValues]
  );
  if (!alreadyInTransaction) await client.query("COMMIT");
}

/*
 * type Trait = {
 *   traitNewid: string,
 *   value: Json,
 *   tokens: integer[],
 *   tokenNewids: string[],
 * }
 *
 * type Feature = {
 *   featureNewid: string,
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
      features.feature_id AS "featureId",
      name,
      traits.trait_id AS "traitId",
      value,
      array_agg(token_id ORDER BY token_id) AS tokens,
      array_agg(token_newid::text ORDER BY token_id) AS "tokenNewids"
    FROM features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
    WHERE project_id = $1
    GROUP BY
      feature_id, trait_id,
      features.name, traits.value  -- functionally dependent
    ORDER BY name, value
    `,
    [projectNewid]
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
      tokens: row.tokens,
      tokenNewids: row.tokenNewids,
    });
  }
  return result;
}

async function getTokenFeaturesAndTraits({
  client,
  tokenNewid,
  projectNewid,
  minTokenIndex,
  maxTokenIndex,
}) {
  if (tokenNewid == null && projectNewid == null) {
    throw new Error("must filter by either project ID or token ID");
  }
  const res = await client.query(
    `
    SELECT
      tokens.token_id AS "tokenId",
      tokens.token_newid AS "tokenNewid",
      token_index AS "tokenIndex",
      features.feature_id AS "featureId",
      name,
      traits.trait_id AS "traitId",
      value
    FROM
      features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
      RIGHT OUTER JOIN tokens USING (token_newid)
    WHERE true
      AND (tokens.token_newid = $1 OR $1 IS NULL)
      AND (
        tokens.project_newid = $2 OR $2 IS NULL
        OR tokens.project_newid IS NULL  -- OUTER JOIN
      )
      AND (token_index >= $3 OR $3 IS NULL)
      AND (token_index <= $4 OR $4 IS NULL)
    ORDER BY
      tokens.token_contract,
      tokens.on_chain_token_id,
      feature_id,
      trait_id
    `,
    [tokenNewid, projectNewid, minTokenIndex, maxTokenIndex]
  );

  const result = [];
  let currentToken = {};
  for (const row of res.rows) {
    if (currentToken.tokenId !== row.tokenId) {
      currentToken = {
        tokenId: row.tokenId,
        tokenNewid: row.tokenNewid,
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
      project_newid AS "projectNewid",
      token_data->'image' AS "imageUrl",
      token_data->'token_hash' AS "tokenHash"
    FROM tokens
    ORDER BY token_id ASC
  `);
  return res.rows;
}

async function getTokenSummaries({ client, tokens }) {
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      token_newid AS "tokenNewid",
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
    LEFT OUTER JOIN artblocks_projects
      ON projects.project_newid = artblocks_projects.project_id
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

// NOTE: This function is newid-compliant.
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
//   - projectId: string (newid, not legacy Art Blocks ID)
//   - completedThroughTokenIndex: number
//
// notifications along `imageProgressChannel` for changes that are not no-ops.
//
// NOTE: This function is newid-compliant.
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
  projectNewidsFromArtblocksIndices,
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
