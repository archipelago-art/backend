const log = require("../../util/log")(__filename);

async function backfill({ pool, verbose }) {
  const projectsRes = await pool.query(
    `
    SELECT project_id AS "projectId", artblocks_project_index AS "artblocksProjectIndex"
    FROM artblocks_projects
    `
  );
  const projectIds = projectsRes.rows.map((x) => x.projectId);
  const projectIndices = projectsRes.rows.map((x) => x.artblocksProjectIndex);
  const imageTemplates = projectIndices.map(
    (x) => `{baseUrl}/artblocks/{sz}/${x}/{hi}/{lo}`
  );
  const artblocksRes = await pool.query(
    `
    UPDATE projects
    SET image_template = updates.image_template
    FROM (
      SELECT
        unnest($1::projectid[]) AS project_id,
        unnest($2::text[]) AS image_template
    ) AS updates
    WHERE projects.project_id = updates.project_id
    `,
    [projectIds, imageTemplates]
  );
  if (verbose) {
    log.info`updated ${artblocksRes.rowCount} artblocks projects`;
  }

  const autoglyphsRes = await pool.query(
    `
    UPDATE projects
    SET image_template = '{baseUrl}/autoglyphs/svg/{lo}'
    WHERE slug='autoglyphs'
    `
  );
  if (verbose) {
    log.info`updated ${autoglyphsRes.rowCount} autoglyphs projects :)`;
  }
  const cryptoadzRes = await pool.query(
    `
    UPDATE projects
    SET image_template = '{baseUrl}/cryptoadz/img/{hi}/{lo}'
    WHERE slug='cryptoadz'
    `
  );
  if (verbose) {
    log.info`updated ${cryptoadzRes.rowCount} cryptoadz projects :)`;
  }
}

module.exports = backfill;
