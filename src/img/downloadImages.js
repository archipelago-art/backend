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

async function imagemagick(rootDir1, rootDir2, tokenId, convertOptions) {
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
    ...convertOptions,
    outputPath,
  ]);
  return outputPath;
}

async function resizeImage(rootDir1, rootDir2, tokenId, outputSizePx) {
  if (!Number.isSafeInteger(outputSizePx))
    throw new Error("bad output size: " + outputSizePx);
  const options = ["-resize", `${outputSizePx}x${outputSizePx}`];
  return await imagemagick(rootDir1, rootDir2, tokenId, options);
}

async function letterboxImage(
  rootDir1,
  rootDir2,
  tokenId,
  letterboxGeometry,
  background
) {
  if (typeof letterboxGeometry !== "string")
    throw new Error("bad letterbox geometry: " + letterboxGeometry);
  const options = [];
  options.push("-resize", letterboxGeometry);
  options.push("-background", background);
  options.push("-gravity", "Center");
  options.push("-extent", letterboxGeometry);
  return await imagemagick(rootDir1, rootDir2, tokenId, options);
}

module.exports = { downloadImage, resizeImage, letterboxImage };
