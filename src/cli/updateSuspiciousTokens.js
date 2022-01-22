const artblocks = require("../db/artblocks");
const { acqrel, withPool } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);

const NETWORK_CONCURRENCY = 32;

async function updateSuspiciousTokens(args, self) {
  let checkSusTraits = true;
  let checkSusTraitless = true;
  for (const arg of args) {
    switch (arg) {
      case "--no-sus-traits":
        checkSusTraits = false;
        break;
      case "--no-sus-traitless":
        checkSusTraitless = false;
        break;
      default:
        throw new Error(
          `usage: ${self} [--no-sus-traits] [--no-sus-traitless]`
        );
    }
  }

  await withPool(async (pool) => {
    const [tokensFromSuspiciousTraits, suspiciousTraitlessTokens] =
      await Promise.all([
        !checkSusTraits
          ? []
          : acqrel(pool, (client) =>
              artblocks.findSuspiciousTraits({ client })
            ),
        !checkSusTraitless
          ? []
          : acqrel(pool, (client) =>
              artblocks.findSuspiciousTraitlessTokens({ client })
            ),
      ]);
    const tokenIds = Array.from(
      new Set([...tokensFromSuspiciousTraits, ...suspiciousTraitlessTokens])
    );
    const artblocksTokenIds = await acqrel(pool, async (client) => {
      const res = await artblocks.getArtblocksTokenIds({ client, tokenIds });
      return res.sort((a, b) => a.artblocksTokenId - b.artblocksTokenId);
    });
    log.info`got ${artblocksTokenIds.length} suspicious token IDs (${tokensFromSuspiciousTraits.length} from sus traits, ${suspiciousTraitlessTokens.length} traitless)`;
    async function worker() {
      await acqrel(pool, async (client) => {
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
            await artblocks.updateTokenData({ client, tokenId, rawTokenData });
            log.info`updated token data for token ${artblocksTokenId}`;
          } catch (e) {
            log.warn`failed to add token ${artblocksTokenId}: ${e}`;
          }
        }
      });
    }
    await Promise.all(
      Array(NETWORK_CONCURRENCY)
        .fill()
        .map(() => worker())
    );
  });
}

module.exports = updateSuspiciousTokens;
