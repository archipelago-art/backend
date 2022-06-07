const {
  addCryptoadz,
  fixCryptoadz,
  addSpecialCryptoadz,
} = require("../db/cryptoadz");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function main(args) {
  if (args.length !== 1) {
    throw new Error("usage: add-cryptoadz <add|fix|add-special>");
  }
  switch (args[0]) {
    case "add": {
      await withClient((client) => addCryptoadz({ client }));
      log.info`added toadz :)`;
      break;
    }
    case "fix": {
      await withClient((client) => fixCryptoadz({ client }));
      log.info`fixed toadz :)`;
      break;
    }
    case "add-special": {
      await withClient(async (client) => {
        log.info`adding special toadz`;
        const n = await addSpecialCryptoadz({ client });
        log.info`added ${n} special toadz :)`;
      });
      break;
    }
    default:
      throw new Error("usage: add-cryptoadz <add|fix|add-special>");
  }
}

module.exports = main;
