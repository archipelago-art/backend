const log = require("../../util/log")(__filename);
const slug = require("../../util/slugify");
const { acqrel } = require("../util");

async function backfillProjectSlugs({ pool, verbose }) {
  const { rows: sluglessProjects } = await pool.query(`
    SELECT project_id AS id, name FROM projects WHERE slug IS NULL
  `);
  const updates = sluglessProjects.map(({ id, name }) => ({
    id,
    slug: slug(name),
  }));
  const res = await pool.query(
    `
    UPDATE projects
    SET slug = updates.slug
    FROM (
      SELECT unnest($1::int[]) AS project_id, unnest($2::text[]) AS slug
    ) AS updates
    WHERE projects.project_id = updates.project_id AND projects.slug IS NULL
    RETURNING updates.project_id AS id, name, updates.slug AS slug
    `,
    [sluglessProjects.map((x) => x.id), updates.map((x) => x.slug)]
  );
  if (verbose) {
    for (const { id, name, slug } of res.rows.sort((a, b) => a.id - b.id)) {
      log.info`${id}: ${JSON.stringify(name)} -> ${JSON.stringify(slug)}`;
    }
  }
}

module.exports = backfillProjectSlugs;
