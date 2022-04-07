const addCryptoadz = require("../db/cryptoadz");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function main(args) {
  try {
    await withClient((client) => addCryptoadz({ client }));
    log.info`added toadz :)`;
  } catch (e) {
    log.error`failed to add toadz: ${e}`;
    process.exitCode = 1;
    return;
  }
}

module.exports = main;
