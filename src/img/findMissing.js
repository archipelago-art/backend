const contracts = require("../api/contracts");
const artblocks = require("../db/artblocks");
const log = require("../util/log")(__filename);
const { targets } = require("./ingestTargets");

function setdefault(map, k, fv) {
  let v = map.get(k);
  if (v != null) return v;
  v = fv();
  map.set(k, v);
  return v;
}

// Returns map from token ID (as an integer) to array of resolutions (like
// `["orig", "1200p"]`).
async function list(bucket /*: gcs.Bucket */, prefix) {
  if (prefix.length > 0 && !prefix.endsWith("/")) {
    throw new Error("non-empty prefix must end with slash, but got: " + prefix);
  }
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
        const [resolution, contractName, millionsRaw, subMillionsRaw] =
          relname.split("/");
        const millions = Number(millionsRaw);
        const subMillions = Number(subMillionsRaw);
        const onChainTokenId = millions * 1e6 + subMillions;
        const tokenIdToResolutions = setdefault(
          result,
          contractName,
          () => new Map()
        );
        setdefault(tokenIdToResolutions, onChainTokenId, () => []).push(
          resolution
        );
      });
  });
}

async function findMissing({ client, bucket, prefix = "tokens/", dryRun }) {
  const octd = await artblocks.getOnChainTokenData({ client });
  log.debug`fetched on-chain data for ${octd.length} tokens`;
  const listing = await list(bucket, prefix);
  log.debug`fetched GCS listing for ${listing.size} contracts`;
  const artblocksWantResolutions = targets().map((t) => t.name);
  const missingImages /*: Array<TokenId> */ = [];
  for (const { tokenContract, onChainTokenId } of octd) {
    const contractName = contracts.contractForAddress(tokenContract).name;
    let wantResolutions;
    switch (contractName) {
      case "artblocks":
        wantResolutions = artblocksWantResolutions;
        break;
      case "cryptoadz":
        wantResolutions = ["orig"];
        break;
      case "autoglyphs":
        wantResolutions = ["orig"];
        break;
      default:
        throw new Error("unknown contract name: " + contractName);
    }
    const resolutions =
      (listing.get(contractName) ?? new Map()).get(Number(onChainTokenId)) ??
      [];
    const missing = wantResolutions.filter((r) => !resolutions.includes(r));
    if (missing.length === 0) continue;
    log.info`${contractName}#${onChainTokenId}: missing ${missing.join(", ")}`;
    missingImages.push(onChainTokenId);
  }
  if (dryRun) return 0;
  const res = await client.query(
    `
    INSERT INTO image_ingestion_queue (token_id, create_time)
    VALUES (unnest($1::tokenid[]), now())
    ON CONFLICT DO NOTHING
    `,
    [missingImages]
  );
  return res.rowCount;
}

module.exports = findMissing;
