const { withClient } = require("../db/util");
const { downloadAllCollections } = require("./download");
const { ingestEvents } = require("../db/opensea/ingestEvents");
const log = require("../util/log")(__filename);

const ONE_MINUTE = 1000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function syncLoop({ apiKey, client, windowDurationMs, sleepDurationMs }) {
  log.info`opensea-sync: starting loop (sleepDurationMs: ${sleepDurationMs}, windowDurationMs=${windowDurationMs})`;
  while (true) {
    log.info`opensea-sync: downloading events for all collections`;
    await downloadAllCollections({ client, apiKey, windowDurationMs });
    log.info`opensea-sync: ingesting events`;
    await ingestEvents({ client });
    log.info`opensea-sync: sleeping ${sleepDurationMs} ms`;
    await sleepMs(sleepDurationMs);
  }
}

module.exports = { syncLoop };
