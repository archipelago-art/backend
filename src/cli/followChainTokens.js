const artblocks = require("../db/artblocks");
const erc721Transfers = require("../db/erc721Transfers");
const { acqrel, withPool } = require("../db/util");
const tokenTransfers = require("../eth/tokenTransfers");
const { fetchProjectData } = require("../scrape/fetchArtblocksProject");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);

const NETWORK_CONCURRENCY = 32;
const SLEEP_DELAY_MS = 1000 * 10;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function followChainTokens(args) {
  await withPool(async (pool) => {
    while (true) {
      await followChainTokensOnce(pool);
      await sleepMs(SLEEP_DELAY_MS);
    }
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

module.exports = followChainTokens;
