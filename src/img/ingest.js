const fs = require("fs");
const { join, dirname } = require("path");
const util = require("util");

const { downloadImage, resizeImage } = require("./downloadImages");
const { imagePath } = require("./paths");

function resizeTarget(dim) {
  return { name: `${dim}p`, type: "RESIZE", dim };
}

const ORIG = "orig";

// Order matters: the `ORIGINAL` target should come first.
const TARGETS = [
  { name: ORIG, type: "ORIGINAL" },
  ...[1200, 800, 600, 400, 200].map(resizeTarget),
];

function uploadMetadata() {
  return { contentType: "image/png" };
}

async function makeTarget(ctx, token, target) {
  const gcsPath = imagePath(token.tokenId, { slash: true });
  const origDir = join(ctx.workDir, ORIG);
  const targetDir = join(ctx.workDir, target.name);
  switch (target.type) {
    case "ORIGINAL": {
      const img = await downloadImage(targetDir, token.imageUrl, token.tokenId);
      await ctx.bucket.upload(img, {
        destination: `${ctx.prefix}${target.name}/${gcsPath}`,
        metadata: uploadMetadata(),
      });
      break;
    }
    case "RESIZE": {
      const inputPath = join(origDir, imagePath(token.tokenId));
      if (!(await util.promisify(fs.exists)(inputPath))) {
        await util.promisify(fs.mkdir)(dirname(inputPath), { recursive: true });
        await ctx.bucket
          .file(`${ctx.prefix}${ORIG}/${gcsPath}`)
          .download({ destination: inputPath });
      }
      const img = await resizeImage(
        origDir,
        targetDir,
        token.tokenId,
        target.dim
      );
      await ctx.bucket.upload(img, {
        destination: `${ctx.prefix}${target.name}/${gcsPath}`,
        metadata: uploadMetadata(),
      });
      break;
    }
    default:
      throw new Error("unknown image target type: " + target.type);
  }
}

async function process(ctx, token, listing) {
  const have = listing.get(token.tokenId) ?? [];
  for (const target of TARGETS) {
    if (have.includes(target.name)) continue;
    try {
      await makeTarget(ctx, token, target);
      console.log(`processed ${target.name} for token ${token.tokenId}`);
    } catch (e) {
      console.error(
        `failed to process ${target.name} for token ${token.tokenId}:`,
        e
      );
    }
  }
}

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
