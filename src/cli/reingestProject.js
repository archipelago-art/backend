const artblocks = require("../db/artblocks");
const { acqrel, withPool } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const Cmp = require("../util/cmp");
const log = require("../util/log")(__filename);

const NETWORK_CONCURRENCY = 32;

async function reingestProject(args) {
  const [slug] = args;
  if (args.length !== 1)
    throw new Error("usage: reingest-project PROJECT_SLUG");
  await withPool(async (pool) => {
    const tokens = await acqrel(pool, async (client) => {
      const projectId = await artblocks.getProjectIdBySlug({ client, slug });
      if (projectId == null)
        throw new Error("no such project with slug: " + slug);
      const tokenIds = await artblocks.getProjectTokens({ client, projectId });
      const tokens = await artblocks.getArtblocksTokenIds({ client, tokenIds });
      tokens.sort(Cmp.comparing((t) => t.artblocksTokenId));
      return tokens;
    });
    log.info`will reingest ${tokens.length} tokens`;
    async function worker() {
      while (true) {
        const item = tokens.shift();
        if (item == null) return;
        const { tokenId, artblocksTokenId } = item;
        log.debug`fetching token ${artblocksTokenId} (token ID ${tokenId})`;
        try {
          const token = await fetchTokenData(artblocksTokenId);
          const rawTokenData = token.raw;
          if (rawTokenData == null) {
            log.info`token ${token} not found; skipping`;
            return;
          }
          await acqrel(pool, async (client) => {
            await artblocks.updateTokenData({ client, tokenId, rawTokenData });
          });
          log.info`updated token data for token ${artblocksTokenId}`;
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

module.exports = reingestProject;
