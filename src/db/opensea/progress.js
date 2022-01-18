// Return the last updated timestamp for a given contract
// slug is an opensea collection slug
async function getLastUpdated({ client, slug, projectId }) {
  if (projectId == null) {
    throw new Error("null projectId");
  }
  const res = await client.query(
    `
    SELECT until
    FROM opensea_progress
    WHERE opensea_slug = $1
    `,
    [slug]
  );
  const rows = res.rows;
  if (rows.length === 0) {
    return null;
  }
  return rows[0].until;
}

// slug is an opensea collection slug
// until is a js Date
async function setLastUpdated({ client, slug, until, projectId }) {
  if (projectId == null) {
    throw new Error("null projectId");
  }
  await client.query(
    `
    INSERT INTO opensea_progress (opensea_slug, until, project_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (opensea_slug) DO UPDATE SET
      until = $2,
      project_id = $3
    `,
    [slug, until, projectId]
  );
}

module.exports = {
  getLastUpdated,
  setLastUpdated,
};
