const log = require("../../util/log")(__filename);

async function backfillImageProgressProjectIds({ pool, verbose }) {
  const res = await pool.query(`
    UPDATE image_progress SET project_id = project_newid
  `);
  if (verbose) {
    log.info`updated ${res.rowCount} entries`;
  }
}

module.exports = backfillImageProgressProjectIds;
