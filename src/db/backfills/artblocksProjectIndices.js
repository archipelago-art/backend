async function backfillArtblocksProjectIndices({ pool, verbose }) {
  const res = await pool.query(`
    INSERT INTO artblocks_projects (project_id, artblocks_project_index)
    SELECT
      project_newid AS project_id,
      project_id AS artblocks_project_index
    FROM projects AS p
    WHERE NOT EXISTS (
      SELECT 1 FROM artblocks_projects AS ap
      WHERE ap.project_id = p.project_newid
    )
  `);
  if (verbose) {
    console.log("updated %s projects", res.rowCount);
  }
}

module.exports = backfillArtblocksProjectIndices;
