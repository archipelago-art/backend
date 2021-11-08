const fs = require("fs");
const { join, dirname } = require("path");
const util = require("util");

const {
  downloadImage,
  resizeImage,
  letterboxImage,
} = require("./downloadImages");
const { imagePath } = require("./paths");

function resizeTarget(dim) {
  return { name: `${dim}p`, type: "RESIZE", dim };
}

function letterboxTarget({ name, geometry, bg }) {
  return {
    name,
    type: "LETTERBOX",
    geometry,
    background: bg,
  };
}

const ORIG = "orig";

// Order matters: the `ORIGINAL` target should come first.
const TARGETS = [
  { name: ORIG, type: "ORIGINAL" },
  ...[1200, 800, 600, 400, 200].map(resizeTarget),
  letterboxTarget({ name: "social", geometry: "1200x628", bg: "black" }),
];

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
      await ctx.bucket
        .file(`${ctx.prefix}${ORIG}/${gcsPath}`)
        .download({ destination: inputPath });
    }
  }

  let img;
  switch (target.type) {
    case "ORIGINAL": {
      img = await downloadImage(targetDir, token.imageUrl, token.tokenId);
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
  const have = listing.get(token.tokenId) ?? [];
  for (const target of TARGETS) {
    if (have.includes(target.name)) continue;
    if (ctx.dryRun) {
      console.log(`would process ${target.name} for token ${token.tokenId}`);
      continue;
    }
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
