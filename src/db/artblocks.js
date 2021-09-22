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
    `,
    [tokenId]
  );
  return res.rows.map((row) => row.name);
}

module.exports = {
  addProject,
  getProject,
  addToken,
  getTokenFeatures,
};
