const log = require("../../util/log")(__filename);
const { acqrel } = require("../util");

async function backfillTokenNewids({ pool, verbose }) {
  await acqrel(pool, async (client) => {
    const tokensRes = await client.query(`
      UPDATE tokens SET token_id = token_newid
    `);
    log.info`updated ${tokensRes.rowCount} tokens`;

    const traitMembersRes = await client.query(`
      UPDATE trait_members SET token_id = token_newid
    `);
    log.info`updated ${traitMembersRes.rowCount} trait membership entries`;
  });
}

module.exports = backfillTokenNewids;
