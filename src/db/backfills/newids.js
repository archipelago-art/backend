const log = require("../../util/log")(__filename);
const { ObjectType, newIds } = require("../id");

const BATCH_SIZE = 16384;

async function batchUpdate({ tableName, ids, update, verbose }) {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const theseIds = ids.slice(i, i + BATCH_SIZE);
    await update(theseIds);
    if (verbose) {
      log.info`${tableName}: updated ${i + theseIds.length} / ${
        ids.length
      } rows`;
    }
  }
}

async function projects({ pool, verbose }) {
  const res = await pool.query(`
    SELECT project_id AS id FROM projects
    WHERE project_newid IS NULL
    ORDER BY project_id
  `);
  await batchUpdate({
    tableName: "projects",
    ids: res.rows.map((r) => r.id),
    verbose,
    async update(ids) {
      const newids = newIds(ids.length, ObjectType.PROJECT);
      await pool.query(
        `
        UPDATE projects
        SET project_newid = updates.new
        FROM (
          SELECT unnest($1::int[]) AS old, unnest($2::int8[]) AS new
        ) AS updates
        WHERE projects.project_id = updates.old AND projects.project_newid IS NULL
        `,
        [ids, newids]
      );
    },
  });
}

async function tokens({ pool, verbose }) {
  const res = await pool.query(`
    SELECT token_id AS id FROM tokens
    WHERE token_newid IS NULL
    ORDER BY token_id
  `);
  await batchUpdate({
    tableName: "tokens",
    ids: res.rows.map((r) => r.id),
    verbose,
    async update(ids) {
      const newids = newIds(ids.length, ObjectType.TOKEN);
      await pool.query(
        `
        UPDATE tokens
        SET
          token_newid = updates.new,
          project_newid = (
            SELECT project_newid FROM projects
            WHERE projects.project_id = tokens.project_id
          )
        FROM (
          SELECT unnest($1::int[]) AS old, unnest($2::int8[]) AS new
        ) AS updates
        WHERE tokens.token_id = updates.old AND tokens.token_newid IS NULL
        `,
        [ids, newids]
      );
    },
  });
}

async function features({ pool, verbose }) {
  const res = await pool.query(`
    SELECT feature_id AS id FROM features
    WHERE feature_newid IS NULL
    ORDER BY feature_id
  `);
  await batchUpdate({
    tableName: "features",
    ids: res.rows.map((r) => r.id),
    verbose,
    async update(ids) {
      const newids = newIds(ids.length, ObjectType.FEATURE);
      await pool.query(
        `
        UPDATE features
        SET
          feature_newid = updates.new,
          project_newid = (
            SELECT project_newid FROM projects
            WHERE projects.project_id = features.project_id
          )
        FROM (
          SELECT unnest($1::int[]) AS old, unnest($2::int8[]) AS new
        ) AS updates
        WHERE features.feature_id = updates.old AND features.feature_newid IS NULL
        `,
        [ids, newids]
      );
    },
  });
}

async function traits({ pool, verbose }) {
  const res = await pool.query(`
    SELECT trait_id AS id FROM traits
    WHERE trait_newid IS NULL
    ORDER BY trait_id
  `);
  await batchUpdate({
    tableName: "traits",
    ids: res.rows.map((r) => r.id),
    verbose,
    async update(ids) {
      const newids = newIds(ids.length, ObjectType.TRAIT);
      await pool.query(
        `
        UPDATE traits
        SET
          trait_newid = updates.new,
          feature_newid = (
            SELECT feature_newid FROM features
            WHERE features.feature_id = traits.feature_id
          )
        FROM (
          SELECT unnest($1::int[]) AS old, unnest($2::int8[]) AS new
        ) AS updates
        WHERE traits.trait_id = updates.old AND traits.trait_newid IS NULL
        `,
        [ids, newids]
      );
    },
  });
}

async function traitMembers({ pool, verbose }) {
  let totalRowCount = 0;
  while (true) {
    const res = await pool.query(
      `
      UPDATE trait_members
      SET
        trait_newid = updates.trait_newid,
        token_newid = updates.token_newid
      FROM (
        SELECT trait_id, token_id, traits.trait_newid, tokens.token_newid
        FROM
          (
            SELECT trait_id, token_id FROM trait_members
            WHERE trait_members.trait_newid IS NULL
            LIMIT $1
          ) AS workset
          JOIN traits USING (trait_id)
          JOIN tokens USING (token_id)
      ) AS updates
      WHERE
        trait_members.trait_id = updates.trait_id
        AND trait_members.token_id = updates.token_id
      `,
      [BATCH_SIZE]
    );
    if (res.rowCount == 0) break;
    totalRowCount += res.rowCount;
    if (verbose) {
      log.info`trait_members: updated ${totalRowCount} rows`;
    }
  }
}

async function backfillNewids({ pool, verbose }) {
  await projects({ pool, verbose });
  await tokens({ pool, verbose });
  await features({ pool, verbose });
  await traits({ pool, verbose });
  await traitMembers({ pool, verbose });
}

module.exports = backfillNewids;
