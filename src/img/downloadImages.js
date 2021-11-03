const child_process = require("child_process");
const fs = require("fs");
const { join, dirname } = require("path");
const util = require("util");

const fetch = require("node-fetch");

const { imagePath } = require("./paths");

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

async function resizeImage(rootDir1, rootDir2, tokenId, outputSizePx) {
  if (!Number.isSafeInteger(outputSizePx))
    throw new Error("bad output size: " + outputSizePx);
  const thisImagePath = imagePath(tokenId);
  const inputPath = join(rootDir1, thisImagePath);
  if (!util.promisify(fs.exists)(inputPath)) {
    // TODO(@wchargin): Hack; do this more nicely.
    return null;
  }
  const outputPath = join(rootDir2, thisImagePath);
  await util.promisify(fs.mkdir)(dirname(outputPath), { recursive: true });
  await util.promisify(child_process.execFile)("convert", [
    inputPath,
    "-resize",
    `${outputSizePx}x${outputSizePx}`,
    outputPath,
  ]);
  return outputPath;
}

module.exports = { downloadImage, resizeImage };
