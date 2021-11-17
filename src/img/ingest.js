const fs = require("fs");
const { join, dirname } = require("path");
const util = require("util");

const artblocks = require("../db/artblocks");
const { acqrel } = require("../db/util");
const downloadAtomic = require("../util/gcsDownloadAtomic");
const {
  downloadImage,
  resizeImage,
  letterboxImage,
} = require("./downloadImages");
const generate = require("./generator");
const { ORIG, targets } = require("./ingestTargets");
const { listingProgress } = require("./list");
const { imagePath } = require("./paths");

function uploadMetadata() {
  return { contentType: "image/png" };
}

async function makeTarget(ctx, token, target) {
  const gcsPath = imagePath(token.tokenId, { slash: true });
  const origDir = join(ctx.workDir, ORIG);
  const targetDir = join(ctx.workDir, target.name);

  async function ensureOriginalExists() {
    const inputPath = join(origDir, imagePath(token.tokenId));
    if (!(await util.promisify(fs.exists)(inputPath))) {
      await util.promisify(fs.mkdir)(dirname(inputPath), { recursive: true });
      await downloadAtomic(ctx.bucket.file(`${ctx.prefix}${ORIG}/${gcsPath}`), {
        destination: inputPath,
      });
    }
    if (!(await util.promisify(fs.exists)(inputPath))) {
      throw new Error("no original image: " + inputPath);
    }
  }

  let img;
  switch (target.type) {
    case "ORIGINAL": {
      const projectId = Math.floor(token.tokenId / 1e6);
      const generatorData = ctx.generatorProjects.get(projectId);
      if (generatorData == null) {
        img = await downloadImage(targetDir, token.imageUrl, token.tokenId);
      } else {
        img = join(targetDir, imagePath(token.tokenId));
        await util.promisify(fs.mkdir)(dirname(img), { recursive: true });
        const tokenData = { tokenId: token.tokenId, hash: token.tokenHash };
        console.log(
          "using generator for %s -> %s: %s",
          token.tokenId,
          img,
          JSON.stringify(tokenData)
        );
        try {
          await generate(generatorData, tokenData, img);
        } catch (e) {
          console.error(
            "failed to generate image for %s:",
            tokenData.tokenId,
            e
          );
        }
        console.log("generated image for %s", tokenData.tokenId);
      }
      break;
    }
    case "RESIZE": {
      await ensureOriginalExists();
      img = await resizeImage(origDir, targetDir, token.tokenId, target.dim);
      break;
    }
    case "LETTERBOX": {
      await ensureOriginalExists();
      img = await letterboxImage(
        origDir,
        targetDir,
        token.tokenId,
        target.geometry,
        target.background
      );
      break;
    }
    default:
      throw new Error("unknown image target type: " + target.type);
  }
  await ctx.bucket.upload(img, {
    destination: `${ctx.prefix}${target.name}/${gcsPath}`,
    metadata: uploadMetadata(),
  });
}

async function process(ctx, token, listing) {
  if (!listing.has(token.tokenId)) listing.set(token.tokenId, []);
  const have = listing.get(token.tokenId);
  const notHave = targets().filter((t) => !have.includes(t.name));
  if (notHave.length === 0) return;
  let allOkay = true;
  for (const target of notHave) {
    if (ctx.dryRun) {
      console.log(`would process ${target.name} for token ${token.tokenId}`);
      continue;
    }
    try {
      await makeTarget(ctx, token, target);
      have.push(target.name);
      console.log(`processed ${target.name} for token ${token.tokenId}`);
    } catch (e) {
      allOkay = false;
      console.error(
        `failed to process ${target.name} for token ${token.tokenId}:`,
        e
      );
    }
  }
  if (allOkay) {
    const projectId = Math.floor(token.tokenId / 1e6);
    const completedThroughTokenId = listingProgress(listing).get(projectId); // wasteful, yes
    if (completedThroughTokenId !== undefined) {
      console.log(
        "updating progress for project %s to token %s%s",
        projectId,
        completedThroughTokenId,
        ctx.dryRun ? " (skipping for dry run)" : ""
      );
      if (!ctx.dryRun) {
        await acqrel(ctx.pool, (client) =>
          artblocks.updateImageProgress({
            client,
            progress: [{ projectId, completedThroughTokenId }],
          })
        );
      }
    }
  }
}

/**
 * Processes images for all specified tokens, and updates the listing to
 * reflect newly created images.
 *
 * `tokens` should be a list of objects with:
 *
 *    - `tokenId`: number, like `23000250`
 *    - `imageUrl`: string from which to download the image
 *    - `tokenHash`: string ("0x...") from which to generate the image
 *
 * `ctx` should be an object with:
 *
 *    - `workDir`: a string like "/mnt/images"
 *    - `bucket`: a `require("gcs").Bucket` instance
 *    - `prefix`: a GCS path prefix, either an empty string or a string ending
 *      with a slash
 *    - `pool`: a `require("pg").Pool`, used to update image progress
 *    - `generatorProjects`: map from project ID (number) to objects with
 *      fields `script: string` and `library: string`; tokens for these
 *      projects will be generated rather than downloaded
 *    - `dryRun`: optional bool; defaults to false
 */
async function processAll(ctx, tokens, listing, options) {
  options = {
    concurrency: 16,
    ...options,
  };
  const q = [...tokens];
  async function worker() {
    while (true) {
      const token = q.shift();
      if (token == null) return;
      await process(ctx, token, listing);
    }
  }
  await Promise.all(
    Array(options.concurrency)
      .fill()
      .map(() => worker())
  );
}

module.exports = { ingest: processAll };
