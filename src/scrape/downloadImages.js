const fs = require("fs");
const { join, dirname } = require("path");
const util = require("util");

const fetch = require("node-fetch");

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

async function downloadImage(rootDir, url, tokenId) {
  const outputPath = join(rootDir, imagePath(tokenId));
  await util.promisify(fs.mkdir)(dirname(outputPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `fetching image from ${url}: ${res.status} ${res.statusText}`
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await util.promisify(fs.writeFile)(outputPath, buf);
  return outputPath;
}

module.exports = { imagePath, downloadImage };
