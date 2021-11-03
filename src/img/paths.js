const { join } = require("path");

function imagePath(tokenId) {
  const project = Math.floor(tokenId / 1e6).toFixed(0);
  const idHigh = Math.floor((tokenId / 1e3) % 1e3)
    .toFixed(0)
    .padStart(3, "0");
  const idLow = Math.floor(tokenId % 1e3)
    .toFixed(0)
    .padStart(3, "0");
  return join(project, idHigh, idLow);
}

module.exports = { imagePath };
