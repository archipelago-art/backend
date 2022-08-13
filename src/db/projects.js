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
       artblocks_project_index AS "artblocksProjectIndex"
    FROM projects
    JOIN artblocks_projects USING (project_id)
    `
  );
  return res.rows.map((row) => ({
    ...row,
    tokenContract: bufToAddress(row.tokenContract),
  }));
}

module.exports = { projectIdForSlug, getAllProjects };
