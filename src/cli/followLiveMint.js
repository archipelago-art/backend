const artblocks = require("../db/artblocks");
const { acqrel, withPool } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);

const LIVE_MINT_INITIAL_DELAY_MS = 10 * 1000;
const LIVE_MINT_MAX_DELAY_MS = 2 * 60 * 1000;
const LIVE_MINT_BACKOFF_MULTIPLE = 1.5;
const LIVE_MINT_FANOUT = 8;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function followLiveMint(args) {
  const [slug] = args;
  await withPool(async (pool) => {
    const projectId = await acqrel(pool, async (client) => {
      const res = await artblocks.getProjectIdBySlug({ client, slug });
      if (res == null) {
        throw new Error(`no project with slug "${slug}"`);
      }
      return res;
    });
    let indices = await acqrel(pool, async (client) => {
      const res = await artblocks.getUnfetchedTokens({ client, projectId });
      return res.map((t) => t.tokenIndex);
    });
    const artblocksProjectIndex = await acqrel(pool, async (client) => {
      const [res] = await artblocks.artblocksProjectIndicesFromIds({
        client,
        projectIds: [projectId],
      });
      if (res == null) {
        throw new Error(`project ${slug} is not an Art Blocks project`);
      }
      return res;
    });
    const baseTokenId = artblocksProjectIndex * artblocks.PROJECT_STRIDE;

    let sleepDuration = LIVE_MINT_INITIAL_DELAY_MS;
    while (true) {
      if (indices.length === 0) {
        log.info`project ${projectId} is fully minted`;
        return;
      }
      log.info`checking for token ${indices[0]}`;
      if (
        !(await tryAddTokenLive({
          pool,
          artblocksTokenId: baseTokenId + indices[0],
        }))
      ) {
        log.info`token ${indices[0]} not ready yet; zzz ${
          sleepDuration / 1000
        }s`;
        await sleepMs(sleepDuration);
        // exponential backoff up to a limit
        sleepDuration = Math.min(
          sleepDuration * LIVE_MINT_BACKOFF_MULTIPLE,
          LIVE_MINT_MAX_DELAY_MS
        );
        continue;
      }
      // found a token, reset exponential backoff
      sleepDuration = LIVE_MINT_INITIAL_DELAY_MS;
      log.info`added token ${indices[0]}; reaching ahead`;
      indices.shift();
      const workItems = [...indices];
      let bailed = false;
      async function worker() {
        while (true) {
          if (bailed) {
            log.info`sibling task bailed; bailing`;
            return;
          }
          const tokenIndex = workItems.shift();
          if (tokenIndex == null) return;
          const artblocksTokenId = baseTokenId + tokenIndex;
          if (!(await tryAddTokenLive({ pool, artblocksTokenId }))) {
            log.info`token ${artblocksTokenId} not ready yet; bailing`;
            bailed = true;
            return;
          }
          log.info`added token ${tokenIndex}`;
          indices = indices.filter((x) => x !== tokenIndex);
        }
      }
      await Promise.all(
        Array(LIVE_MINT_FANOUT)
          .fill()
          .map(() => worker())
      );
      if (indices.length > 0) {
        log.info`going back to sleep`;
        await sleepMs(LIVE_MINT_INITIAL_DELAY_MS);
      }
    }
  });
}

async function tryAddTokenLive({ pool, artblocksTokenId }) {
  try {
    const token = await fetchTokenData(artblocksTokenId, {
      checkFeaturesPresent: true,
    });
    if (!token.found) return false;
    await acqrel(pool, (client) =>
      artblocks.addToken({
        client,
        artblocksTokenId,
        rawTokenData: token.raw,
      })
    );
    return true;
  } catch (e) {
    log.warn`failed to add token ${artblocksTokenId}: ${e}`;
    return false;
  }
}

module.exports = followLiveMint;
