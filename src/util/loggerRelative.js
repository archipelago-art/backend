const { relative } = require("path");

const logger = require("./logger");

function loggerRelative(filename, root) {
  const moduleName = relative(root, filename).replace(/\.m?[jt]sx?$/, "");
  return logger(moduleName);
}

module.exports = loggerRelative;
