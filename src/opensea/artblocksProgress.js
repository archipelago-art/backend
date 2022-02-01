const C = require("../util/combo");
const { fetchAssets } = require("./fetch");
const {
  getProgress,
  getLastUpdated,
  setLastUpdated,
} = require("../db/opensea/progress");
const {
  getProjectIndices,
  ARTBLOCKS_CONTRACT_THRESHOLD,
  CONTRACT_ARTBLOCKS_STANDARD,
  CONTRACT_ARTBLOCKS_LEGACY,
} = require("../db/artblocks");
const log = require("../util/log")(__filename);

const BEGINNING_OF_HISTORY = new Date("2020-11-27");

// Slug used by OpenSea for miscellaneous Art Blocks tokens, sometimes(???).
// This can include the mint-0 token for a project between the time that it's
// minted and the time that OpenSea makes a dedicated collection for the
// project. It also includes some tokens over longer periods of time (e.g.,
// Beauty of Skateboarding #336).
//
// The value is `printf 'Art Blocks Purgatory' | base64 | tr A-Z a-z | tr -d =`.
const PURGATORY_SLUG = "qxj0iejsb2nrcybqdxjnyxrvcnk";

/**
 * Enumerate all of the ArtBlocks collections on OpenSea.
 * Result will be an array of objects with the following form:
 * {projectId, slug, lastUpdated}
 * Where `projectId` is the Archipelago project ID, and `openseaSlug`
 * is a string like "the-eternal-pump-by-dmitri-cherniak",
 * and `lastUpdated` is the last time we downloaded events
 * for this collection (or null if never downloaded).
 */
async function initializeArtblocksProgress({ client, apiKey }) {
  const projects = await getProjectIndices({ client });
  for (project of projects) {
    const lastUpdated = await getLastUpdated({
      client,
      projectId: project.projectId,
    });
    if (lastUpdated == null) {
      const slug = await getSlugForArtblocksProject(
        apiKey,
        project.artblocksProjectIndex
      );
      if (slug === PURGATORY_SLUG) {
        log.warn`got purgatory slug ${slug} for artblocks project with idx ${project.artblocksProjectIndex} (id: ${project.projectId}; skipping`;
        continue;
      }
      if (slug == null) {
        log.warn`can't find slug for artblocks project with idx ${project.artblocksProjectIndex} (id: ${project.projectId})`;
        continue;
      }
      log.info`setting slug ${slug} for project with index ${project.artblocksProjectIndex} (id: ${project.projectId})`;
      await setLastUpdated({
        client,
        projectId: project.projectId,
        slug,
        until: BEGINNING_OF_HISTORY,
      });
    }
  }
}

const slugParser = C.fmap(
  C.object({
    collection: C.object({ slug: C.string }),
  }),
  (x) => x.collection.slug
);

async function getSlugForArtblocksProject(apiKey, artblocksProjectIndex) {
  const contractAddress =
    artblocksProjectIndex < ARTBLOCKS_CONTRACT_THRESHOLD
      ? CONTRACT_ARTBLOCKS_LEGACY
      : CONTRACT_ARTBLOCKS_STANDARD;
  const tokenId = artblocksProjectIndex * 1e6;
  return getOpenseaCollectionSlug({ apiKey, tokenId, contractAddress });
}

async function getOpenseaCollectionSlug({ contractAddress, tokenId, apiKey }) {
  const assets = await fetchAssets({
    contractAddress,
    tokenIds: [tokenId],
    apiKey,
  });
  if (assets.length !== 1) {
    return null;
  }
  return slugParser.parseOrThrow(assets[0]);
}

module.exports = { initializeArtblocksProgress };
