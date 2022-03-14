const addAutoglyphs = require("../db/autoglyphs");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function main(args) {
  try {
    await withClient((client) => addAutoglyphs({ client }));
    log.info`added autoglyphs :)`;
  } catch (e) {
    log.error`failed to add autoglyphs: ${e}`;
    process.exitCode = 1;
    return;
  }
}

module.exports = main;
