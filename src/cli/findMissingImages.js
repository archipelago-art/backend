const gcs = require("@google-cloud/storage");

const { withClient } = require("../db/util");
const findMissing = require("../img/findMissing");
const log = require("../util/log")(__filename);

async function main(args) {
  let dryRun = false;
  let bucket;
  for (const arg of args) {
    if (arg === "-n" || arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (bucket != null) {
      throw new Error("usage: find-missing-images [-n] BUCKET_NAME");
    }
    bucket = new gcs.Storage().bucket(arg);
  }
  if (bucket == null) {
    throw new Error("usage: find-missing-images [-n] BUCKET_NAME");
  }
  const n = await withClient((client) =>
    findMissing({ client, bucket, dryRun })
  );
  log.info`added ${n} new missing token IDs`;
}

module.exports = main;
