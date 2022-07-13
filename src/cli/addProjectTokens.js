const artblocks = require("../db/artblocks");
const { acqrel, withPool } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);

const NETWORK_CONCURRENCY = 64;

async function addProjectTokens(args) {
  const [slug] = args;
  await withPool(async (pool) => {
    const tokens = await acqrel(pool, async (client) => {
      let projectId = null;
      if (slug !== "all") {
        projectId = await artblocks.getProjectIdBySlug({ client, slug });
        if (projectId == null) {
          throw new Error(`no project with slug "${slug}"`);
        }
      }
      return await artblocks.getUnfetchedTokens({ client, projectId });
    });
    log.info`got ${tokens.length} missing tokens`;
    const artblocksProjectIndices = await acqrel(pool, async (client) => {
      const projectIdToCount = new Map();
      for (const t of tokens) {
        const k = t.projectId;
        projectIdToCount.set(k, 1 + (projectIdToCount.get(k) || 0));
      }
      const projectIds = Array.from(projectIdToCount.keys());
      const res = await artblocks.artblocksProjectSpecsFromIds({
        client,
        projectIds,
      });
      const result = new Map();
      for (let i = 0; i < projectIds.length; i++) {
        const k = projectIds[i];
        const v = res[i];
        if (v == null) {
          const n = projectIdToCount.get(k);
          log.warn`project ${k} is not an Art Blocks project; skipping ${n} tokens`;
          continue;
        }
        result.set(k, v);
      }
      return result;
    });
    const chunks = [];
    async function worker() {
      while (true) {
        const item = tokens.shift();
        if (item == null) return;
        const artblocksProjectSpec = artblocksProjectIndices.get(
          item.projectId
        );
        if (artblocksProjectSpec == null) continue;
        const artblocksTokenId =
          artblocksProjectSpec.projectIndex * artblocks.PROJECT_STRIDE +
          item.tokenIndex;
        try {
          log.debug`fetching token ${artblocksTokenId} (project ${item.projectId}, index ${item.tokenIndex})`;
          const token = await fetchTokenData(
            artblocksProjectSpec.tokenContract,
            artblocksTokenId
          );
          if (token.found) {
            await acqrel(pool, (client) =>
              artblocks.addToken({
                client,
                artblocksTokenId,
                rawTokenData: token.raw,
                tokenContract: artblocksProjectSpec.tokenContract,
              })
            );
            log.info`added token ${artblocksTokenId}`;
          } else {
            log.info`skipping token ${artblocksTokenId} (not found)`;
          }
        } catch (e) {
          log.warn`failed to add token ${artblocksTokenId}: ${e}`;
        }
      }
    }
    await Promise.all(
      Array(NETWORK_CONCURRENCY)
        .fill()
        .map(() => worker())
    );
  });
}

module.exports = addProjectTokens;
