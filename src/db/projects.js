const slug = require("../util/slugify");
const { ObjectType, newId, newIds } = require("./id");
const { hexToBuf, bufToAddress } = require("./util");

async function addProject({
  client,
  name,
  maxInvocations,
  artistName,
  description,
  aspectRatio,
  tokenContract,
  imageTemplate,
}) {
  const projectId = newId(ObjectType.PROJECT);
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
    `,
    [
      projectId,
      name,
      maxInvocations,
      artistName,
      description,
      aspectRatio,
      slug(name),
      hexToBuf(tokenContract),
      imageTemplate,
    ]
  );
  return projectId;
}

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

async function isProjectFullyMinted({ client, projectId }) {
  const res = await client.query(
    `
    SELECT p.num_tokens >= p.max_invocations as "isFullyMinted"
    FROM projects p
    WHERE p.project_id = $1::projectid
    `,
    [projectId]
  );
  return res.rows[0].isFullyMinted;
}

async function projectInfoById({ client, projectIds }) {
  const res = await client.query(
    `
    SELECT
      project_id AS "projectId",
      name AS "name",
      slug AS "slug",
      token_contract AS "tokenContract"
    FROM projects
    WHERE project_id = ANY($1::projectid[])
    ORDER BY project_id
    `,
    [projectIds]
  );
  return res.rows.map((r) => ({
    projectId: r.projectId,
    name: r.name,
    slug: r.slug,
    tokenContract: bufToAddress(r.tokenContract),
  }));
}

module.exports = {
  addProject,
  projectIdForSlug,
  isProjectFullyMinted,
  projectInfoById,
};
