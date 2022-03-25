const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function setProjectSlug(args) {
  if (args.length !== 2) {
    throw new Error("usage: set-project-slug OLD_SLUG NEW_SLUG");
  }
  const js = JSON.stringify;
  const [oldSlug, newSlug] = args;
  await withClient(async (client) => {
    const projectId = await artblocks.getProjectIdBySlug({
      client,
      slug: oldSlug,
    });
    if (projectId == null) {
      throw new Error(`no project with slug ${js(oldSlug)}`);
    }
    await artblocks.setProjectSlug({ client, projectId, slug: newSlug });
    log.info`project ${projectId}: changed slug ${js(oldSlug)} -> ${js(
      newSlug
    )}`;
  });
}

module.exports = setProjectSlug;
