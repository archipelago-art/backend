const artblocks = require("../db/artblocks");
const { acqrel, withPool } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);

const NETWORK_CONCURRENCY = 32;

async function updateSuspiciousTokens(args, self) {
  await withPool(async (pool) => {
    const tokenIds = acqrel(pool, (client) =>
      artblocks.findSuspiciousTraitlessTokens({ client })
    );
    const artblocksTokenIds = await acqrel(pool, async (client) => {
      const res = await artblocks.getArtblocksTokenIds({ client, tokenIds });
      return res.sort((a, b) => a.artblocksTokenId - b.artblocksTokenId);
    });
    log.info`got ${artblocksTokenIds.length} suspicious token IDs`;
    async function worker() {
      while (true) {
        const item = artblocksTokenIds.shift();
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

module.exports = updateSuspiciousTokens;
