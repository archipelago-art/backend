const log = require("../../util/log")(__filename);
const { acqrel } = require("../util");

async function backfillProjectNewids({ pool, verbose }) {
  await acqrel(pool, async (client) => {
    const projectsRes = await client.query(`
      UPDATE projects SET project_id = project_newid
    `);
    log.info`updated ${projectsRes.rowCount} projects`;

    const tokensRes = await client.query(`
      UPDATE tokens SET project_id = project_newid
    `);
    log.info`updated ${tokensRes.rowCount} tokens`;
  });
}

module.exports = backfillProjectNewids;
