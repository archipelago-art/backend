const log = require("../../util/log")(__filename);

async function backfillImageProgressNewids({ pool, verbose }) {
  const res = await pool.query(`
    UPDATE image_progress AS t1
    SET
      project_newid = (SELECT project_newid FROM projects t2 WHERE t1.project_id = t2.project_id),
      completed_through_token_index = completed_through_token_id % 1000000
    WHERE project_newid IS NULL OR completed_through_token_index IS NULL
  `);
  if (verbose) {
    log.info`updated ${res.rowCount} entries`;
  }
}

module.exports = backfillImageProgressNewids;
