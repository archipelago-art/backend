const gcs = require("@google-cloud/storage");

const { acqrel, withPool } = require("../db/util");
const { ingestImagePage } = require("../img/ingest2");
const log = require("../util/log")(__filename);

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function ingestImages(args) {
  await withPool(async (pool) => {
    function usage() {
      console.error("usage: ingest-images <bucket-name> <work-dir>");
      return 1;
    }
    if (args.length !== 2) {
      return usage();
    }
    const [bucketName, workDir] = args;
    const bucket = new gcs.Storage().bucket(bucketName);

    await acqrel(pool, async (client) => {
      await ingestImagePage({ workDir, bucket, client });
    });
  });
}

module.exports = ingestImages;
