const { withClient } = require("../db/util");
const {
  syncAllProjects,
  removeDroppedAsks,
  tokensWithAsks,
  syncProject,
} = require("./download");
const { getProgress } = require("../db/opensea/progress");
const { ingestEvents } = require("../db/opensea/ingestEvents");
const { projectIdForSlug } = require("../db/projects");
const log = require("../util/log")(__filename);

const ONE_MINUTE = 1000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function syncLoop({ apiKey, client, sleepDurationMs }) {
  log.info`opensea-sync: starting loop (sleepDurationMs: ${sleepDurationMs})`;
  while (true) {
    log.info`opensea-sync: downloading events for all collections`;
    await syncAllProjects({ client, apiKey });
    log.info`opensea-sync: ingesting events`;
    await ingestEvents({ client });
    log.info`opensea-sync: sleeping ${sleepDurationMs} ms`;
    await sleepMs(sleepDurationMs);
  }
}

const ASKS_PER_SYNC = 5;

async function focusedSync({ apiKey, client, slug, timeoutMinutes }) {
  if (timeoutMinutes == null) {
    timeoutMinutes = Infinity;
  }
  const endTime = Date.now() + timeoutMinutes * 60 * 1000;
  const projectId = await projectIdForSlug({ client, slug });
  const progress = await getProgress({ client, projectId });
  const openseaSlug = progress[0].slug;
  while (true) {
    log.info`restarting focused sync loop for ${slug}`;
    await syncProject({ client, slug: openseaSlug, projectId, apiKey });
    await ingestEvents({ client });
    const tokensToCheck = await client.query(
      `
    SELECT DISTINCT token_id AS "tokenId", token_index AS "tokenIndex"
    FROM opensea_asks
    JOIN tokens USING (token_id)
    JOIN projects ON projects.project_id = opensea_asks.project_id
    WHERE active AND (slug=$1 OR $1 IS NULL)
    `,
      [slug]
    );
    log.info`there are ${tokensToCheck.rows.length} tokens to check for dropped asks`;
    let i = 0;
    for (const { tokenId, tokenIndex } of tokensToCheck.rows) {
      if (i > 0 && i % ASKS_PER_SYNC === 0) {
        log.info`syncing whole project...`;
        await syncProject({ client, slug: openseaSlug, projectId, apiKey });
        await ingestEvents({ client });
      }
      log.info`checking ${slug}#${tokenIndex} for dropped asks`;
      await removeDroppedAsks({ client, tokenId, apiKey });
      i++;
    }
    if (Date.now() > endTime) {
      log.info`Finished focused sync (duration: ${timeoutMinutes} mins), breaking loop`;
      return;
    }
  }
}

module.exports = { syncLoop, focusedSync };
