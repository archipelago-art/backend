const { join } = require("path");

function imagePath(tokenId, options) {
  options = {
    // Join with forward slash, as opposed to OS-dependent delimiter?
    slash: false,
    ...options,
  };
  const project = Math.floor(tokenId / 1e6).toFixed(0);
  const idHigh = Math.floor((tokenId / 1e3) % 1e3)
    .toFixed(0)
    .padStart(3, "0");
  const idLow = Math.floor(tokenId % 1e3)
    .toFixed(0)
    .padStart(3, "0");
  const components = [project, idHigh, idLow];
  if (options.slash) {
    return components.join("/");
  } else {
    return join(...components);
  }
}

module.exports = { imagePath };
