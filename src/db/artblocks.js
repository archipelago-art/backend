const slug = require("slug");

const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");

const PROJECT_STRIDE = 1e6;

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
  return await client.query(
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
      slug
    )
    SELECT
      $1, $2, $3, $4, $5, $6, $7,
      (SELECT count(1) FROM tokens WHERE project_id = $1),
      $8
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
    ]
  );
}

async function getProject({ client, projectId }) {
  const res = await await client.query(
    `
    SELECT
      project_id AS "projectId",
      name as "name",
      max_invocations AS "maxInvocations",
      artist_name AS "artistName",
      description AS "description",
      script_json AS "scriptJson",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      slug AS "slug"
    FROM projects
    WHERE project_id = $1
    `,
    [projectId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
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

async function addToken({
  client,
  tokenId,
  rawTokenData,
  includeTraitMembers = true,
}) {
  await client.query("BEGIN");
  const projectId = Math.floor(tokenId / PROJECT_STRIDE);
  await client.query(
    `
    INSERT INTO tokens (token_id, fetch_time, token_data, project_id)
    VALUES ($1, $2, $3, $4)
    `,
    [tokenId, new Date(), rawTokenData, projectId]
  );
  await client.query(
    `
    UPDATE projects
    SET num_tokens = num_tokens + 1
    WHERE project_id = $1
    `,
    [projectId]
  );
  await client.query(
    `
    INSERT INTO token_features (token_id, feature_name)
    SELECT token_id, kv.key || ': ' || coalesce(kv.value, 'null')
    FROM tokens,
      LATERAL (SELECT token_data->'features' AS features) AS f,
      LATERAL json_each_text(CASE
        WHEN json_typeof(features) = 'object' THEN features
        WHEN json_typeof(features) = 'array' THEN (
          SELECT json_object_agg(ordinality - 1, value)
          FROM LATERAL json_array_elements(features) WITH ORDINALITY
        )
        ELSE 'null'::json  -- will fail hard
      END) AS kv
    WHERE token_id = $1 AND token_data IS NOT NULL
    `,
    [tokenId]
  );

  if (includeTraitMembers) {
    await populateTraitMembers({
      client,
      tokenId,
      projectId,
      rawTokenData,
      alreadyInTransaction: true,
    });
  }

  await client.query("COMMIT");
}

async function populateTraitMembers({
  client,
  tokenId,
  projectId,
  rawTokenData,
  alreadyInTransaction = false,
}) {
  if (rawTokenData == null) return;
  if (!alreadyInTransaction) await client.query("BEGIN");
  const featureData = JSON.parse(rawTokenData).features;
  const featureNames = Object.keys(featureData);
  await client.query(
    `
    INSERT INTO features (project_id, name)
    VALUES ($1, unnest($2::text[]))
    ON CONFLICT DO NOTHING
    `,
    [projectId, featureNames]
  );
  const featureIdsRes = await client.query(
    `
    SELECT feature_id AS "id", name FROM features
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
    INSERT INTO traits (feature_id, value)
    VALUES (
      unnest($1::integer[]),
      unnest($2::jsonb[])
    )
    ON CONFLICT DO NOTHING
    `,
    [featureIds, traitValues]
  );

  await client.query(
    `
    INSERT INTO trait_members (token_id, trait_id)
    SELECT $1, trait_id
    FROM traits
    JOIN unnest($2::integer[], $3::jsonb[]) AS my_traits(feature_id, value)
      USING (feature_id, value)
    ON CONFLICT DO NOTHING
    `,
    [tokenId, featureIds, traitValues]
  );
  if (!alreadyInTransaction) await client.query("COMMIT");
}

/*
 * type Trait = {
 *   id: integer,
 *   value: Json,
 *   tokens: integer[]
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
async function getProjectFeaturesAndTraits({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      feature_id,
      name,
      trait_id,
      value,
      array_agg(token_id ORDER BY token_id) AS tokens
    FROM features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
    WHERE project_id = $1
    GROUP BY feature_id, trait_id
    ORDER BY name, value
    `,
    [projectId]
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
    });
  }
  return result;
}

async function getTokenFeaturesAndTraits({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      feature_id AS "featureId",
      name,
      trait_id AS "traitId",
      value
    FROM features
      JOIN traits USING (feature_id)
      JOIN trait_members USING (trait_id)
    WHERE token_id = $1
    GROUP BY feature_id, trait_id
    ORDER BY name, value
    `,
    [tokenId]
  );
  return res.rows;
}

async function getTokenIds({ client }) {
  const res = await client.query(`
    SELECT token_id AS "tokenId"
    FROM tokens
    ORDER BY token_id ASC
  `);
  return res.rows.map((row) => row.tokenId);
}

async function getTokenFeatures({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT feature_name AS "name"
    FROM token_features
    WHERE token_id = $1
    ORDER BY feature_name ASC
    `,
    [tokenId]
  );
  return res.rows.map((row) => row.name);
}

async function getProjectFeatures({ client, projectId }) {
  const { minTokenId, maxTokenId } = tokenBounds(projectId);
  const res = await client.query(
    `
    SELECT DISTINCT feature_name AS "name"
    FROM token_features
    WHERE $1 <= token_id AND token_id < $2
    ORDER BY feature_name ASC
    `,
    [minTokenId, maxTokenId]
  );
  return res.rows.map((row) => row.name);
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

async function getTokensWithFeature({ client, projectId, featureName }) {
  const { minTokenId, maxTokenId } = tokenBounds(projectId);
  const res = await client.query(
    `
    SELECT token_id AS "tokenId" FROM token_features
    WHERE $1 <= token_id AND token_id < $2
      AND feature_name = $3
    ORDER BY token_id ASC
    `,
    [minTokenId, maxTokenId, featureName]
  );
  return res.rows.map((row) => row.tokenId);
}

async function getTokenImageUrls({ client }) {
  const res = await client.query(`
    SELECT token_id AS "tokenId", token_data->'image' AS "imageUrl"
    FROM tokens
    ORDER BY token_id ASC
  `);
  return res.rows;
}

async function getTokenSummaries({ client, tokenIds }) {
  const res = await client.query(
    `
    SELECT token_id as "tokenId", name, artist_name as "artistName", slug, aspect_ratio as "aspectRatio"
    FROM tokens
    JOIN projects USING(project_id)
    WHERE token_id = ANY($1::int[])
    ORDER BY token_id;
  `,
    [tokenIds]
  );
  return res.rows;
}

module.exports = {
  addProject,
  getProject,
  setProjectSlug,
  addToken,
  populateTraitMembers,
  getProjectFeaturesAndTraits,
  getTokenFeaturesAndTraits,
  getTokenIds,
  getTokenFeatures,
  getProjectFeatures,
  getUnfetchedTokenIds,
  getAllUnfetchedTokenIds,
  getTokensWithFeature,
  getTokenImageUrls,
  getTokenSummaries,
};
