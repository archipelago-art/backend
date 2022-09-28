const { addMintPassProject } = require("../db/qql");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function main(args) {
  if (args.length !== 1) {
    throw new Error("usage: add-qql <qql | mint-pass>");
  }
  switch (args[0]) {
    case "qql": {
      throw new Error("NYE");
    }
    case "mint-pass": {
      await withClient((client) => addMintPassProject({ client }));
      log.info`added mint pass`;
      return;
    }
    default:
      throw new Error("check usage");
  }
}

module.exports = main;
