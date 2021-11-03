const { parseImagePath } = require("./paths");

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

module.exports = { list };
