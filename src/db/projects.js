const { bufToAddress } = require("./util");

async function projectIdForSlug({ client, slug }) {
  const res = await client.query(
    `
    SELECT project_id AS "projectId"
    FROM projects
    WHERE slug = $1
    `,
    [slug]
  );
  if (res.rows.length === 0) {
    return null;
  }
  return res.rows[0].projectId;
}

async function getAllProjects({ client }) {
  const res = await client.query(
    `
    SELECT project_id AS "projectId",
       slug,
       num_tokens AS "numTokens",
       projects.token_contract AS "tokenContract",
       artblocks_project_index AS "artblocksProjectIndex",
       image_template AS "imageTemplate"
    FROM projects
    LEFT OUTER JOIN artblocks_projects USING (project_id)
    `
  );
  return res.rows.map((row) => ({
    ...row,
    tokenContract: bufToAddress(row.tokenContract),
  }));
}

async function isProjectFullyMinted({ client, projectId }) {
  const res = await client.query(
    `
    SELECT p.num_tokens as totalTokens, count(t.token_id) as totalMinted
    FROM projects p
    JOIN tokens t ON p.project_id = t.project_id
    WHERE p.project_id = $1
    group by num_tokens;
    `,
    [projectId]
  );
  return res.totalMinted === res.totalTokens;
}

module.exports = { projectIdForSlug, getAllProjects, isProjectFullyMinted };
