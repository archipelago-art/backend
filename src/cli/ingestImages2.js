const gcs = require("@google-cloud/storage");

const { acqrel, withPool } = require("../db/util");
const { ingestImages } = require("../img/ingest2");
const log = require("../util/log")(__filename);

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function ingestImagesCli(args) {
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
      await ingestImages({ workDir, bucket, client });
    });
  });
}

module.exports = ingestImagesCli;
