const child_process = require("child_process");
const fs = require("fs");
const { join, dirname } = require("path");
const util = require("util");

const fetch = require("node-fetch");

const { contractForAddress } = require("../api/contracts");
const ws = require("../db/ws");
const { bufToAddress } = require("../db/util");
const downloadAtomic = require("../util/gcsDownloadAtomic");
const log = require("../util/log")(__filename);
const { ORIG, targets } = require("./ingestTargets");

function imageInfo(token) {
  const res = contractForAddress(token.tokenContract);
  if (res == null) {
    throw new Error(
      `no info for token ${token.slug} #${token.tokenIndex} (missing contract ${token.tokenContract})`
    );
  }
  return res;
}

const LOOP_TIMEOUT_MS = 15 * 1000;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

function uploadMetadata() {
  return { contentType: "image/png" };
}

function identifier(token) {
  return `${token.slug} #${token.tokenIndex}`;
}

async function downloadImage(path, url) {
  await util.promisify(fs.mkdir)(dirname(path), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `fetching image from ${url}: ${res.status} ${res.statusText}`
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await util.promisify(fs.writeFile)(path, buf);
}

async function resizeImage(origPath, targetPath, outputSizePx) {
  if (!Number.isSafeInteger(outputSizePx))
    throw new Error("bad output size: " + outputSizePx);
  const options = ["-resize", `${outputSizePx}x${outputSizePx}`];
  await imagemagick(origPath, targetPath, options);
}

async function imagemagick(origPath, targetPath, convertOptions) {
  if (!util.promisify(fs.exists)(origPath)) {
    throw new Error("can't find original");
  }
  await util.promisify(fs.mkdir)(dirname(targetPath), { recursive: true });
  await util.promisify(child_process.execFile)("convert", [
    origPath,
    ...convertOptions,
    targetPath,
  ]);
}

function imagePath(token, targetName, options) {
  options = {
    // Join with forward slash, as opposed to OS-dependent delimiter?
    slash: false,
    ...options,
  };
  const { name: projectName } = imageInfo(token);
  const { tokenContract, onChainTokenId } = token;
  const idHigh = Math.floor(onChainTokenId / 1e6).toFixed(0);
  const idLow = Math.floor(onChainTokenId % 1e6)
    .toFixed(0)
    .padStart(6, "0");
  const components = ["tokens", targetName, projectName, idHigh, idLow];
  if (options.slash) {
    return components.join("/");
  } else {
    return join(...components);
  }
}

async function letterboxImage(
  origPath,
  targetPath,
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
  return await imagemagick(origPath, targetPath, options);
}

async function ingestImages({ workDir, bucket, client }) {
  while (true) {
    const before = new Date();
    while (await ingestImagePage({ workDir, bucket, client, before }));
    log.info`done with queue; sleeping ${LOOP_TIMEOUT_MS} ms`;
    await sleepMs(LOOP_TIMEOUT_MS);
  }
}

// Returns true if there is more to do :-)
async function ingestImagePage({
  workDir,
  bucket,
  client,
  pageSize = 100,
  before = Date.now(),
}) {
  await client.query("BEGIN");
  const tokenIdsRes = await client.query(
    `
    DELETE FROM image_ingestion_queue
    WHERE token_id = ANY(
      SELECT token_id FROM image_ingestion_queue
      WHERE create_time < $2::timestamptz
      ORDER BY create_time ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING token_id AS "tokenId"
  `,
    [pageSize, before]
  );
  const tokenIds = tokenIdsRes.rows.map((x) => x.tokenId);
  if (tokenIds.length === 0) {
    await client.query("ROLLBACK");
    return false;
  }

  const tokensRes = await client.query(
    `
    SELECT
      tokens.token_id AS "tokenId",
      tokens.on_chain_token_id AS "onChainTokenId",
      tokens.token_index AS "tokenIndex",
      projects.project_id AS "projectId",
      projects.token_contract AS "tokenContract",
      projects.slug,
      artblocks_tokens.token_data->>'token_hash' AS "tokenHash"
    FROM tokens
      JOIN projects USING (project_id)
      LEFT OUTER JOIN artblocks_tokens USING (token_id)
    WHERE token_id = ANY($1::tokenid[])
    ORDER BY project_id, token_id
    `,
    [tokenIds]
  );
  const tokens = tokensRes.rows.map((x) => ({
    ...x,
    tokenContract: bufToAddress(x.tokenContract),
  }));
  const failedTokenIds = await ingestTokens({
    workDir,
    bucket,
    client,
    tokens,
  });
  await client.query(
    `
    INSERT INTO image_ingestion_queue (token_id, create_time)
    VALUES (unnest($1::tokenid[]), now())
    `,
    [failedTokenIds]
  );

  const failedTokenIdsSet = new Set(failedTokenIds);
  const messages = tokens
    .filter((t) => !failedTokenIdsSet.has(t.tokenId))
    .map((t) => ({
      type: "IMAGES_UPDATED",
      topic: t.slug,
      data: {
        projectId: t.projectId,
        tokenId: t.tokenId,
        slug: t.slug,
        tokenIndex: t.tokenIndex,
        tokenContract: t.tokenContract,
        onChainTokenId: t.onChainTokenId,
      },
    }));
  await ws.sendMessages({ client, messages });

  await client.query("COMMIT");
  return true;
}

async function ingestTokens({ workDir, bucket, tokens, options }) {
  options = {
    concurrency: 16,
    updateProgress: true,
    ...options,
  };
  const q = [...tokens];
  const failedTokenIds = [];
  async function worker() {
    while (true) {
      const token = q.shift();
      if (token == null) return;
      const success = await process({ workDir, bucket, token, options });
      if (!success) {
        failedTokenIds.push(token.tokenId);
      }
    }
  }
  await Promise.all(
    Array(options.concurrency)
      .fill()
      .map(() => worker())
  );
  return failedTokenIds;
}

async function process({ workDir, bucket, token, options }) {
  let allOkay = true;
  for (const target of targets()) {
    try {
      await makeTarget({ workDir, bucket, token, target });
      log.info`processed ${target.name} for ${identifier(token)}`;
    } catch (e) {
      allOkay = false;
      log.error`failed to process ${target.name} for ${identifier(
        token
      )}: ${e}`;
    }
  }
  return allOkay;
}

async function makeTarget({ workDir, bucket, token, target }) {
  const gcsPath = imagePath(token, target.name, { slash: true });
  const origPath = join(workDir, imagePath(token, ORIG));
  await util.promisify(fs.mkdir)(dirname(origPath), { recursive: true });
  const targetPath = join(workDir, imagePath(token, target.name));
  await util.promisify(fs.mkdir)(dirname(targetPath), { recursive: true });

  async function ensureOriginalExists() {
    if (!(await util.promisify(fs.exists)(origPath))) {
      await downloadAtomic(bucket.file(`${gcsPath}`), {
        destination: origPath,
      });
    }
    if (!(await util.promisify(fs.exists)(origPath))) {
      throw new Error("no original image: " + origPath);
    }
  }

  switch (target.type) {
    case "ORIGINAL": {
      const projectId = Math.floor(token.onChainTokenId / 1e6);
      if (token.slug === "chromie-squiggle") {
        const args = [
          "generate-squiggle",
          token.onChainTokenId % 1e6,
          token.tokenHash,
          targetPath,
        ];
        log.info`using squigglator for ${identifier(
          token
        )} -> ${targetPath}: ${JSON.stringify(args)}`;
        try {
          const pkg = dirname(dirname(__dirname));
          await util.promisify(child_process.execFile)("node", [pkg, ...args]);
        } catch (e) {
          log.error`failed to squigglate image for ${identifier(token)}: ${e}`;
          throw e;
        }
        log.info`generated image for ${identifier(token)}`;
      } else {
        const { externalUrl } = imageInfo(token);
        const imageUrl = externalUrl.replace("{tokenid}", token.onChainTokenId);
        await downloadImage(targetPath, imageUrl);
      }
      break;
    }
    case "RESIZE": {
      await ensureOriginalExists();
      await resizeImage(origPath, targetPath, target.dim);
      break;
    }
    case "LETTERBOX": {
      await ensureOriginalExists();
      await letterboxImage(
        origPath,
        targetPath,
        target.geometry,
        target.background
      );
      break;
    }
    default:
      throw new Error("unknown image target type: " + target.type);
  }
  await bucket.upload(targetPath, {
    destination: gcsPath,
    metadata: uploadMetadata(),
  });
}

module.exports = { ingestImages };
