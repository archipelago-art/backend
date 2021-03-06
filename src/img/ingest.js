const child_process = require("child_process");
const fs = require("fs");
const { join, dirname } = require("path");
const util = require("util");

const artblocks = require("../db/artblocks");
const { acqrel } = require("../db/util");
const downloadAtomic = require("../util/gcsDownloadAtomic");
const log = require("../util/log")(__filename);
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

const CHROMIE_SQUIGGLE = 0;

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
      if (projectId === CHROMIE_SQUIGGLE) {
        img = join(targetDir, imagePath(token.tokenId));
        await util.promisify(fs.mkdir)(dirname(img), { recursive: true });
        const args = [
          "generate-squiggle",
          token.tokenId % 1e6,
          token.tokenHash,
          img,
        ];
        log.info`using squigglator for ${
          token.tokenId
        } -> ${img}: ${JSON.stringify(args)}`;
        try {
          const pkg = dirname(dirname(__dirname));
          await util.promisify(child_process.execFile)("node", [pkg, ...args]);
        } catch (e) {
          log.error`failed to squigglate image for ${token.tokenId}: ${e}`;
          throw e;
        }
        log.info`generated image for ${token.tokenId}`;
      } else if (generatorData == null) {
        img = await downloadImage(targetDir, token.imageUrl, token.tokenId);
      } else {
        img = join(targetDir, imagePath(token.tokenId));
        await util.promisify(fs.mkdir)(dirname(img), { recursive: true });
        const tokenData = { tokenId: token.tokenId, hash: token.tokenHash };
        log.info`using generator for ${
          token.tokenId
        } -> ${img}: ${JSON.stringify(tokenData)}`;
        try {
          await generate(generatorData, tokenData, img);
        } catch (e) {
          log.error`failed to generate image for ${tokenData.tokenId}: ${e}`;
        }
        log.info`generated image for ${tokenData.tokenId}`;
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

async function process(ctx, token, listing, options) {
  if (!listing.has(token.tokenId)) listing.set(token.tokenId, []);
  const have = listing.get(token.tokenId);
  const notHave = targets().filter((t) => !have.includes(t.name));
  if (notHave.length === 0) return;
  let allOkay = true;
  for (const target of notHave) {
    if (ctx.dryRun) {
      log.info`would process ${target.name} for token ${token.tokenId}`;
      continue;
    }
    try {
      await makeTarget(ctx, token, target);
      have.push(target.name);
      log.info`processed ${target.name} for token ${token.tokenId}`;
    } catch (e) {
      allOkay = false;
      log.error`failed to process ${target.name} for token ${token.tokenId}: ${e}`;
    }
  }
  if (allOkay && options.updateProgress) {
    await updateProgress(ctx, token, listing);
  }
}

async function updateProgress(ctx, token, listing) {
  const artblocksProjectIndex = Math.floor(token.tokenId / 1e6);
  const completedThroughTokenId = listingProgress(listing).get(
    artblocksProjectIndex
  ); // wasteful, yes
  if (completedThroughTokenId === undefined) {
    return;
  }
  log.info`updating progress for project ${artblocksProjectIndex} to token ${completedThroughTokenId}${
    ctx.dryRun ? " (skipping for dry run)" : ""
  }`;
  const completedThroughTokenIndex =
    completedThroughTokenId == null ? null : completedThroughTokenId % 1e6;
  const { projectId } = token;
  if (!ctx.dryRun) {
    await acqrel(ctx.pool, (client) =>
      artblocks.updateImageProgress({
        client,
        progress: [{ projectId, completedThroughTokenIndex }],
      })
    );
  }
}

/**
 * Processes images for all specified tokens, and updates the listing to
 * reflect newly created images.
 *
 * `tokens` should be a list of objects with:
 *
 *    - `tokenId`: number, like `23000250`: NOTE: Art Blocks token ID, not Archipelago ID
 *    - `projectId`: string (Archipelago project ID)
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
 *
 * `options` may have:
 *    - `concurrency`: number of imagemagick workers
 *    - `updateProgress`: set to `false` to not update `image_progress` table
 *      (for re-ingesting projects)
 */
async function ingest(ctx, tokens, listing, options) {
  options = {
    concurrency: 16,
    updateProgress: true,
    ...options,
  };
  const q = [...tokens];
  async function worker() {
    while (true) {
      const token = q.shift();
      if (token == null) return;
      await process(ctx, token, listing, options);
    }
  }
  await Promise.all(
    Array(options.concurrency)
      .fill()
      .map(() => worker())
  );
}

module.exports = { ingest };
