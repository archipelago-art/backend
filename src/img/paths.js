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

const RE_IMAGE_PATH = /^([0-9]*)[/\\]([0-9]{3})[/\\]([0-9]{3})$/;

function parseImagePath(path) {
  const match = path.match(RE_IMAGE_PATH);
  if (match == null) return null;
  return parseInt(match[1] + match[2] + match[3], 10);
}

module.exports = { imagePath, parseImagePath };
