const { dirname } = require("path");

const loggerRelative = require("./loggerRelative");

const root = dirname(__dirname); // .../src

/**
 * Usage: at the top of your file, add
 *
 *    const log = require("./util/log")(__filename);
 *
 * and then use
 *
 *    log.info`hello ${world}`;
 *
 * as documented in `logger.js`. See `logger.js` for more docs.
 */
function logger(yourFilename) {
  return loggerRelative(yourFilename, dirname(__dirname));
}

module.exports = logger;
