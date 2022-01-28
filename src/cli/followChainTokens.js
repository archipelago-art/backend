const artblocks = require("../db/artblocks");
const erc721Transfers = require("../db/erc721Transfers");
const { acqrel, withPool } = require("../db/util");
const tokenTransfers = require("../eth/tokenTransfers");
const { fetchProjectData } = require("../scrape/fetchArtblocksProject");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const adHocPromise = require("../util/adHocPromise");
const log = require("../util/log")(__filename);

const NETWORK_CONCURRENCY = 32;
// After each loop, wait until a new deferral event or for this many seconds,
// whichever comes first.
const MAX_DELAY_SECONDS = 60;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

function makeWakePromise() {
  const p = adHocPromise();
  p.promise.then(
    (payload) => log.info`scheduling wake for new deferral: ${payload}`
  );
  return p;
}

async function followChainTokens(args) {
  await withPool(async (pool) => {
    let newDeferrals = makeWakePromise();
    await acqrel(pool, async (listenClient) => {
      listenClient.on("notification", (n) => {
        if (n.channel !== erc721Transfers.deferralsChannel.name) return;
        newDeferrals.resolve(n.payload);
      });
      await erc721Transfers.deferralsChannel.listen(listenClient);

      while (true) {
        await followChainTokensOnce(pool);
        log.info`sleeping for up to ${MAX_DELAY_SECONDS} seconds`;
        const wakeReason = await Promise.race([
          sleepMs(MAX_DELAY_SECONDS * 1000).then(() => "sleep"),
          newDeferrals.promise.then(() => "new deferrals notification"),
        ]);
        log.info`woke from ${wakeReason}`;
        newDeferrals = makeWakePromise();
      }
    });
  });
}

async function followChainTokensOnce(pool) {
  await acqrel(pool, async (client) => {
    const deferrals = await erc721Transfers.getPendingDeferrals({
      client,
      tokenContracts: [
        artblocks.CONTRACT_ARTBLOCKS_LEGACY,
        artblocks.CONTRACT_ARTBLOCKS_STANDARD,
      ],
    });
    const projects = new Map();
    for (const { onChainTokenId } of deferrals) {
      const artblocksProjectIndex = Math.floor(
        Number(onChainTokenId) / artblocks.PROJECT_STRIDE
      );
      let entry = projects.get(artblocksProjectIndex);
      if (entry == null) {
        entry = [];
        projects.set(artblocksProjectIndex, entry);
      }
      entry.push(onChainTokenId);
    }
    log.debug`will try ${deferrals.length} tokens across ${projects.size} projects`;
    if (log.debug.isEnabled()) {
      for (const [projectIndex, tokenIds] of projects) {
        const highest = tokenIds[tokenIds.length - 1];
        log.debug`  project ${projectIndex}: ${tokenIds.length} tokens, up to ${highest}`;
      }
    }

    // First, add any missing projects.
    const projectIndices = Array.from(projects.keys());
    const projectIds = await artblocks.projectIdsFromArtblocksIndices({
      client,
      indices: projectIndices,
    });
    const newProjects = projectIndices.filter((_, i) => projectIds[i] == null);
    const projectsAdded = await parmap(
      NETWORK_CONCURRENCY,
      newProjects,
      async (projectIndex) => {
        try {
          log.debug`requesting Art Blocks project ${projectIndex}`;
          const project = await fetchProjectData(projectIndex);
          if (project == null) {
            console.warn("skipping phantom project %s", projectIndex);
          } else {
            await acqrel(pool, (client) =>
              artblocks.addProject({ client, project })
            );
            log.info`added project ${project.projectId} (${project.name})`;
            return { projectIndex, added: true };
          }
        } catch (e) {
          log.error`failed to add project ${projectIndex}: ${e}`;
        }
        return { projectIndex, added: false };
      }
    );
    for (const { projectIndex, added } of projectsAdded) {
      // Don't bother trying to add tokens if we couldn't add the project.
      if (!added) projects.delete(projectIndex);
    }

    // Now, add any missing tokens.
    let totalAdded = 0;
    await parmap(
      NETWORK_CONCURRENCY,
      Array.from(projects.values()).flat(),
      async (artblocksTokenId) => {
        try {
          log.debug`fetching token ${artblocksTokenId}`;
          const token = await fetchTokenData(artblocksTokenId);
          if (!token.found) {
            log.info`token ${artblocksTokenId} not found; nothing to add`;
            return;
          }
          const tokenId = await acqrel(pool, async (client) => {
            return await artblocks.addToken({
              client,
              artblocksTokenId,
              rawTokenData: token.raw,
            });
          });
          log.info`added Art Blocks token ${artblocksTokenId} with ID ${tokenId}`;
          totalAdded++;
        } catch (e) {
          log.warn`failed to add token ${artblocksTokenId}: ${e}`;
        }
      }
    );
    log.info`added ${totalAdded} tokens`;

    if (totalAdded > 0) {
      await tokenTransfers.undeferTransfers({ pool });
    }
  });
}

async function parmap(batchSize, xs, f) {
  const result = Array(xs.length).fill();
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < result.length) {
      const i = nextIdx++;
      result[i] = await f(xs[i]);
    }
  }
  await Promise.all(
    Array(batchSize)
      .fill()
      .map(() => worker())
  );
  return result;
}

module.exports = followChainTokens;
