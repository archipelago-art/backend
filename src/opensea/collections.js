const C = require("../util/combo");
const { fetchAssets } = require("./fetch");
const {
  getProjectIndices,
  ARTBLOCKS_CONTRACT_THRESHOLD,
  CONTRACT_ARTBLOCKS_STANDARD,
  CONTRACT_ARTBLOCKS_LEGACY,
} = require("../db/artblocks");

/**
 * Enumerate all of the ArtBlocks collections on OpenSea.
 * Result will be an array of objects with the following form:
 * {projectId, slug}
 * Where `projectId` is the Archipelago project ID, and `openseaSlug`
 * is a string like "the-eternal-pump-by-dmitri-cherniak"
 */
async function getProjectSlugs({ client, apiKey }) {
  const projects = await getProjectIndices({ client });

  const legacyProjects = projects.filter(
    (x) => x.artblocksProjectIndex < ARTBLOCKS_CONTRACT_THRESHOLD
  );
  const nonLegacyProjects = projects.filter(
    (x) => x.artblocksProjectIndex >= ARTBLOCKS_CONTRACT_THRESHOLD
  );
  const legacySlugs = await _getSlugs({
    contractAddress: CONTRACT_ARTBLOCKS_LEGACY,
    projects: legacyProjects,
    apiKey,
  });
  const nonLegacySlugs = await _getSlugs({
    contractAddress: CONTRACT_ARTBLOCKS_STANDARD,
    projects: nonLegacyProjects,
    apiKey,
  });
  return [...legacySlugs, ...nonLegacySlugs];
}

const slugParser = C.fmap(
  C.object({
    token_id: C.string,
    collection: C.object({ slug: C.string }),
  }),
  (x) => ({ slug: x.collection.slug, tokenId: x.token_id })
);
async function _getSlugs({ contractAddress, projects, apiKey }) {
  const tokenIds = projects.map((x) => x.artblocksProjectIndex * 1e6);
  const indexToProjectId = new Map(
    projects.map((x) => [x.artblocksProjectIndex, x.projectId])
  );
  const assets = await fetchAssets({ contractAddress, tokenIds, apiKey });
  const slugsWithTokenIds = assets.map((x) => slugParser.parseOrThrow(x));
  return slugsWithTokenIds.map((x) => {
    const projectId = indexToProjectId.get(Math.floor(x.tokenId / 1e6));
    if (projectId == null) {
      throw new Error(`no projectId: ${x.tokenId}, ${x.slug}`);
    }
    return { slug: x.slug, projectId };
  });
}

module.exports = { getProjectSlugs };
