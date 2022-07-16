const { withClient } = require("../db/util");
const { projectIdForSlug } = require("../db/projects");
const log = require("../util/log")(__filename);

async function reingestProjectImagesCli(args) {
  if (args.length !== 1) {
    throw new Error("usage: reingest-project-images slug");
  }
  const slug = args[0];
  await withClient(async (client) => {
    const projectId = await projectIdForSlug({ client, slug });
    if (projectId == null) {
      throw new Error(`can't find project id for ${slug}`);
    }
    const res = await client.query(
      `
      INSERT INTO image_ingestion_queue (token_id, create_time)
      SELECT token_id, now() FROM tokens
      WHERE project_id = $1
      ON CONFLICT DO NOTHING
      `,
      [projectId]
    );
    log.info`will reingest ${res.rowCount} images`;
  });
}

module.exports = reingestProjectImagesCli;
