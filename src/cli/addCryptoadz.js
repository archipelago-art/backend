const { addCryptoadz, fixCryptoadz } = require("../db/cryptoadz");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function main(args) {
  if (args.length === 0) {
    try {
      await withClient((client) => addCryptoadz({ client }));
      log.info`added toadz :)`;
    } catch (e) {
      log.error`failed to add toadz: ${e}`;
      process.exitCode = 1;
      return;
    }
  } else if (args.length === 1 && args[0] === "fix") {
    try {
      await withClient((client) => fixCryptoadz({ client }));
      log.info`fixed toadz :)`;
    } catch (e) {
      log.error`failed to fix toadz: ${e}`;
      process.exitCode = 1;
      return;
    }
  } else {
    throw new Error("usage: add-cryptoadz [fix]");
  }
}

module.exports = main;
