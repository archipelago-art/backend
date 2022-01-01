const log = require("../../util/log")(__filename);

async function backfillTraitsFeaturesNewids({ pool, verbose }) {
  const featuresRes = await pool.query(`
    UPDATE features SET feature_id = feature_newid, project_id = project_newid
  `);
  log.info`updated ${featuresRes.rowCount} features`;

  const traitsRes = await pool.query(`
    UPDATE traits SET trait_id = trait_newid, feature_id = feature_newid
  `);
  log.info`updated ${traitsRes.rowCount} traits`;

  const traitMembersRes = await pool.query(`
    UPDATE trait_members SET trait_id = trait_newid
  `);
  log.info`updated ${traitMembersRes.rowCount} trait membership entries`;
}

module.exports = backfillTraitsFeaturesNewids;
