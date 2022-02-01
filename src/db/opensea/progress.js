// Return the last updated timestamp for a given contract
// slug is an opensea collection slug
async function getLastUpdated({ client, projectId }) {
  if (projectId == null) {
    throw new Error("null projectId");
  }
  const res = await client.query(
    `
    SELECT until
    FROM opensea_progress
    WHERE project_id = $1
    `,
    [projectId]
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
    ON CONFLICT (project_id) DO UPDATE SET
      opensea_slug = $1,
      until = $2
    `,
    [slug, until, projectId]
  );
}

/**
 * Deletes a progress entry for an Archipelago project ID. Returns `true` if
 * this had an effect or `false` if there was no entry.
 */
async function deleteLastUpdated({ client, projectId }) {
  if (projectId == null) {
    throw new Error("null projectId");
  }
  const res = await client.query(
    `
    DELETE FROM opensea_progress WHERE project_id = $1
    `,
    [projectId]
  );
  return res.rowCount > 0;
}

async function getProgress({ client }) {
  const res = await client.query(
    `
    SELECT
      until AS "lastUpdated",
      project_id AS "projectId",
      opensea_slug AS slug
    FROM opensea_progress
    `
  );
  return res.rows;
}

module.exports = {
  getLastUpdated,
  setLastUpdated,
  deleteLastUpdated,
  getProgress,
};
