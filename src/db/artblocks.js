const PROJECT_STRIDE = 1e6;

function tokenBounds(projectId) {
  const minTokenId = projectId * PROJECT_STRIDE;
  const maxTokenId = minTokenId + PROJECT_STRIDE;
  return { minTokenId, maxTokenId };
}

async function addProject({ client, project }) {
  return await client.query(
    `
    INSERT INTO projects (project_id, name, max_invocations)
    VALUES ($1, $2, $3)
    `,
    [project.projectId, project.name, project.maxInvocations]
  );
}

async function getProject({ client, projectId }) {
  const res = await await client.query(
    `
    SELECT
      project_id AS "projectId",
      name as "name",
      max_invocations AS "maxInvocations"
    FROM projects
    WHERE project_id = $1
    `,
    [projectId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

async function addToken({ client, tokenId, rawTokenData }) {
  await client.query("BEGIN");
  await client.query("DELETE FROM tokens WHERE token_id = $1", [tokenId]);
  const res = await client.query(
    `
    INSERT INTO tokens (token_id, fetch_time, token_data)
    VALUES ($1, $2, $3)
    `,
    [tokenId, new Date(), rawTokenData]
  );
  const rowId = res.rows[0];
  await client.query("DELETE FROM token_features WHERE token_id = $1", [
    tokenId,
  ]);
  await client.query(
    `
    INSERT INTO token_features (token_id, feature_name)
    SELECT token_id, features.key || ': ' || features.value
    FROM tokens, LATERAL json_each_text(token_data->'features') AS features
    WHERE token_id = $1
    `,
    [tokenId]
  );
  await client.query("COMMIT");
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
      GENERATE_SERIES(
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

module.exports = {
  addProject,
  getProject,
  addToken,
  getTokenFeatures,
  getProjectFeatures,
  getUnfetchedTokenIds,
  getTokensWithFeature,
};
