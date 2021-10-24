const artblocks = require("../artblocks");
const { acqrel } = require("../util");

const Mode = Object.freeze({
  INIT: "init",
  POPULATE: "populate",
});

async function backfillTraitMembers({ pool, verbose, args }) {
  const mode = args.length === 1 ? args[0] : null;
  switch (mode) {
    case Mode.INIT:
      return await init({ pool, verbose });
    case Mode.POPULATE:
      return await populate({ pool, verbose });
      mode !== Mode.INIT && mode !== Mode.POPULATE;
    default:
      throw new Error(
        `specify either "${Mode.INIT}" or "${Mode.POPULATE}" as backfill arg`
      );
  }
}

backfillTraitMembers.Mode = Mode;

async function init({ pool, verbose }) {
  const res = await pool.query(`
    INSERT INTO backfill_state_trait_members
    SELECT token_id FROM tokens
    ON CONFLICT DO NOTHING
  `);
  if (verbose) {
    console.log("marked %s token IDs as needing backfill", res.rowCount);
  }
}

async function populate({ pool, verbose }) {
  const BATCH_SIZE = 100;
  while (true) {
    const res = await pool.query(
      `
      SELECT
        token_id AS "tokenId",
        project_id AS "projectId",
        token_data::text AS "rawTokenData"
      FROM tokens JOIN backfill_state_trait_members USING (token_id)
      LIMIT $1
      `,
      [BATCH_SIZE]
    );
    if (res.rows.length === 0) break;
    if (verbose) {
      console.log("fetched batch of %s token IDs to backfill", res.rows.length);
    }
    await Promise.all(
      res.rows.map((r) =>
        acqrel(pool, (client) =>
          artblocks.populateTraitMembers({
            client,
            tokenId: r.tokenId,
            projectId: r.projectId,
            rawTokenData: r.rawTokenData,
          })
        )
      )
    );
    await pool.query(
      `
      DELETE FROM backfill_state_trait_members
      WHERE token_id = ANY($1::integer[])
      `,
      [res.rows.map((r) => r.tokenId)]
    );
  }
}

module.exports = backfillTraitMembers;
