const { withPool } = require("../db/util");
const log = require("../util/log")(__filename);
const digest = require("../email/digest");

const DELAY_MS = 1000 * 60 * 15;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function addToken(args) {
  await withPool(async (pool) => {
    while (true) {
      await digest.sendAllDigests({ pool });
      await sleepMs(DELAY_MS);
    }
  });
}

module.exports = addToken;
