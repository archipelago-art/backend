const channels = require("../db/channels");
const cnfs = require("../db/cnfs");
const { acqrel, withPool } = require("../db/util");
const adHocPromise = require("../util/adHocPromise");
const log = require("../util/log")(__filename);

const WAIT_DURATION_SECONDS = 60;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function watchCnfQueue(args) {
  if (args.length !== 0) {
    console.error("usage: watch-cnf-queue");
    return 1;
  }
  await withPool(async (pool) => {
    let newEvents = adHocPromise();
    const channel = channels.traitsUpdated;
    await acqrel(pool, async (listenClient) => {
      listenClient.on("notification", (n) => {
        if (n.channel !== channel.name) return;
        log.info`scheduling wake for trait update event: ${n.payload}`;
        newEvents.resolve();
      });
      await channel.listen(listenClient);

      while (true) {
        const result = await acqrel(pool, (client) =>
          cnfs.processTraitUpdateQueue({ client })
        );
        log.info`processed: ${JSON.stringify(result)}`;
        if (result.madeProgress) {
          log.info`made progress; checking queue again immediately`;
          continue;
        }
        log.info`sleeping for up to ${WAIT_DURATION_SECONDS} seconds`;
        const wakeReason = await Promise.race([
          sleepMs(WAIT_DURATION_SECONDS * 1000).then(() => "woke from sleep"),
          newEvents.promise.then(() => "woke from new events notification"),
        ]);
        newEvents = adHocPromise();
        log.info`${wakeReason}`;
      }
    });
  });
}

module.exports = watchCnfQueue;
