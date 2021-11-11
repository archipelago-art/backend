const { parseImagePath } = require("./paths");
const { targets } = require("./ingestTargets");

// Returns map from token ID (as an integer) to array of resolutions (like
// `["orig", "1200p"]`).
async function list(bucket /*: gcs.Bucket */, prefix) {
  if (prefix.length > 0 && !prefix.endsWith("/"))
    throw new Error(`non-empty prefix should end with slash: "${prefix}"`);
  // Have to use a streaming result set, or Node will run out of memory for the
  // intermediate file objects and dump core.
  return new Promise((res, rej) => {
    const result = new Map();
    bucket
      .getFilesStream({ prefix })
      .on("error", rej)
      .on("end", () => res(result))
      .on("data", (f) => {
        const relname = f.name.slice(prefix.length);
        const [resolution] = relname.split("/", 1);
        const tokenId = parseImagePath(relname.slice(resolution.length + 1));
        if (tokenId == null) {
          console.warn(
            "unrecognized file name: %s (%s)",
            f.name,
            relname.slice(resolution.length + 1)
          );
          return;
        }
        let resolutions = result.get(tokenId);
        if (resolutions == null) {
          resolutions = [];
          result.set(tokenId, resolutions);
        }
        resolutions.push(resolution);
      });
  });
}

// Returns a map from project ID (integer) to the highest token ID `n` such
// that for all token IDs `m <= n` within the project, token `m` has all images
// generated, or `null` if the project has images for some token but not its
// token #0. The map will not include entries for projects with no tokens at
// all, which may be inconvenient to callers.
function listingProgress(listing) {
  const targetNames = targets().map((t) => t.name);
  const result = new Map();
  for (const tokenId of Array.from(listing.keys()).sort((a, b) => a - b)) {
    const projectId = Math.floor(tokenId / 1e6);
    const last = result.get(projectId);
    if (last === null) {
      // Already know that we don't have token #0; no possible change.
      continue;
    }
    const resolutions = listing.get(tokenId);
    const hasAllResolutions = targetNames.every((t) => resolutions.includes(t));

    if (last === undefined) {
      if (tokenId % 1e6 === 0 && hasAllResolutions) {
        result.set(projectId, tokenId);
      } else {
        result.set(projectId, null);
      }
      continue;
    }

    if (hasAllResolutions && last + 1 === tokenId) {
      result.set(projectId, tokenId);
    }
  }
  return result;
}

module.exports = { list, listingProgress };
