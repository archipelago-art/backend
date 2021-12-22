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
 * Result will be an array of string slugs, as in
 * ["chromie-squiggle-by-snowfro", ...]
 */
async function getSlugs({ client, apiKey }) {
  const projectIds = await getProjectIndices({ client });
  const legacyProjectIds = projectIds.filter(
    (x) => x < ARTBLOCKS_CONTRACT_THRESHOLD
  );
  const nonLegacyProjectIds = projectIds.filter(
    (x) => x >= ARTBLOCKS_CONTRACT_THRESHOLD
  );
  const legacySlugs = await _getSlugs({
    contractAddress: CONTRACT_ARTBLOCKS_LEGACY,
    projectIds: legacyProjectIds,
    apiKey,
  });
  const nonLegacySlugs = await _getSlugs({
    contractAddress: CONTRACT_ARTBLOCKS_STANDARD,
    projectIds: nonLegacyProjectIds,
    apiKey,
  });
  return [...legacySlugs, ...nonLegacySlugs];
}

const slugParser = C.fmap(
  C.object({ collection: C.object({ slug: C.string }) }),
  (x) => x.collection.slug
);
async function _getSlugs({ contractAddress, projectIds, apiKey }) {
  const tokenIds = projectIds.map((x) => x * 1e6);
  const assets = await fetchAssets({ contractAddress, tokenIds, apiKey });
  const slugs = assets.map((x) => slugParser.parseOrThrow(x));
  return slugs;
}

module.exports = { getSlugs };
