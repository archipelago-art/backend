const fs = require("fs");
const http = require("http");
const https = require("https");
const pg = require("pg");
const util = require("util");
const ws = require("ws");

const artblocks = require("./db/artblocks");
const backfills = require("./db/backfills");
const migrations = require("./db/migrations");
const { acqrel } = require("./db/util");
const images = require("./img");
const { fetchProjectData } = require("./scrape/fetchArtblocksProject");
const { fetchTokenData } = require("./scrape/fetchArtblocksToken");
const attach = require("./ws");
const adHocPromise = require("./util/adHocPromise");

const NETWORK_CONCURRENCY = 64;
const IMAGEMAGICK_CONCURRENCY = 16;

const INGESTION_LATENCY_SECONDS = 15;

const LIVE_MINT_LATENCY_SECONDS = 5;
const LIVE_MINT_FANOUT = 8;

const GENERATOR_WHITELIST = [23 /* Archetype */, 200 /* Saturazione */];

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function withDb(callback) {
  const pool = new pg.Pool();
  try {
    return await acqrel(pool, (client) => callback({ pool, client }));
  } finally {
    await pool.end();
  }
}

async function init() {
  await withDb(async ({ client }) => {
    await migrations.applyAll({ client, verbose: true });
  });
}

// usage: migrate [<migration-name> [...]]
// where each <migration-name> must be a substring of a unique migration
async function migrate(args) {
  await withDb(async ({ client }) => {
    const desiredMigrations = args.map((needle) => {
      const matches = migrations.migrations.filter((m) =>
        m.name.includes(needle)
      );
      if (matches.length === 0)
        throw new Error(`no migrations named like "${needle}"`);
      if (matches.length > 1)
        throw new Error(
          `multiple migrations named like "${needle}": ${matches
            .map((m) => m.name)
            .join(", ")}`
        );
      return matches[0];
    });
    await migrations.apply({
      client,
      migrations: desiredMigrations,
      verbose: true,
    });
  });
}

// usage: backfill <backfill-module-name>
// where <backfill-module-name> is the basename of a file in
// `src/db/backfills`, without the `.js` extension
async function backfill(args) {
  const [backfillName, ...backfillArgs] = args;
  const backfill = backfills[backfillName];
  if (backfill == null) throw new Error("unknown backfill " + backfillName);
  await withDb(async ({ pool }) => {
    await backfill({ pool, args: backfillArgs, verbose: true });
  });
}

async function addProject(args) {
  const [projectId] = args;
  await withDb(async ({ client }) => {
    try {
      const project = await fetchProjectData(projectId);
      if (project == null) {
        console.warn("skipping phantom project %s", projectId);
        return;
      }
      await artblocks.addProject({ client, project });
      console.log("added project %s (%s)", project.projectId, project.name);
    } catch (e) {
      console.error("failed to add project %s: %s", projectId, e);
      process.exitCode = 1;
      return;
    }
  });
}

async function getProject(args) {
  const [projectId] = args;
  await withDb(async ({ client }) => {
    console.log(await artblocks.getProject({ client, projectId }));
  });
}

async function addToken(args) {
  const [tokenId] = args;
  await withDb(async ({ client }) => {
    const token = await fetchTokenData(tokenId);
    await artblocks.addToken({ client, tokenId, rawTokenData: token.raw });
  });
}

async function addProjectTokens(args) {
  const [projectId] = args;
  await withDb(async ({ pool }) => {
    const ids = await acqrel(pool, (client) =>
      projectId === "all"
        ? artblocks.getAllUnfetchedTokenIds({ client })
        : artblocks.getUnfetchedTokenIds({ client, projectId })
    );
    console.log(`got ${ids.length} missing IDs`);
    const chunks = [];
    async function worker() {
      while (true) {
        const tokenId = ids.shift();
        if (tokenId == null) return;
        try {
          const token = await fetchTokenData(tokenId);
          if (token.found) {
            await acqrel(pool, (client) =>
              artblocks.addToken({
                client,
                tokenId,
                rawTokenData: token.raw,
              })
            );
            console.log("added token " + tokenId);
          } else {
            console.log("skipping token %s (not found)", tokenId);
          }
        } catch (e) {
          console.log("failed to add token " + tokenId);
          console.error(e);
          console.error(`failed to add token ${tokenId}: ${e}`);
        }
      }
    }
    await Promise.all(
      Array(NETWORK_CONCURRENCY)
        .fill()
        .map(() => worker())
    );
  });
}

async function followLiveMint(args) {
  const projectId = parseInt(args[0], 10);
  await withDb(async ({ pool }) => {
    let ids = await acqrel(pool, (client) =>
      artblocks.getUnfetchedTokenIds({ client, projectId })
    );
    while (true) {
      if (ids.length === 0) {
        console.log(`project ${projectId} is fully minted`);
        return;
      }
      console.log(`checking for ${ids[0]}`);
      if (!(await tryAddTokenLive({ pool, tokenId: ids[0] }))) {
        console.log(`token ${ids[0]} not ready yet; zzz`);
        await sleepMs(LIVE_MINT_LATENCY_SECONDS * 1000);
        continue;
      }
      console.log(`added token ${ids[0]}; reaching ahead`);
      ids.shift();
      const workItems = [...ids];
      let bailed = false;
      async function worker() {
        while (true) {
          if (bailed) {
            console.log(`sibling task bailed; bailing`);
            return;
          }
          const tokenId = workItems.shift();
          if (tokenId == null) return;
          if (!(await tryAddTokenLive({ pool, tokenId }))) {
            console.log(`token ${tokenId} not ready yet; bailing`);
            bailed = true;
            return;
          }
          console.log(`added token ${tokenId}`);
          ids = ids.filter((x) => x !== tokenId);
        }
      }
      await Promise.all(
        Array(LIVE_MINT_FANOUT)
          .fill()
          .map(() => worker())
      );
      if (ids.length > 0) {
        console.log("going back to sleep");
        await sleepMs(LIVE_MINT_LATENCY_SECONDS * 1000);
      }
    }
  });
}

async function tryAddTokenLive({ pool, tokenId }) {
  try {
    const token = await fetchTokenData(tokenId, { checkFeaturesPresent: true });
    if (!token.found) return false;
    await acqrel(pool, (client) =>
      artblocks.addToken({
        client,
        tokenId,
        rawTokenData: token.raw,
      })
    );
    return true;
  } catch (e) {
    console.log("failed to add token " + tokenId);
    console.error(e);
    console.error(`failed to add token ${tokenId}: ${e}`);
    return false;
  }
}

async function downloadImages(args) {
  const [rootDir] = args;
  await withDb(async ({ pool }) => {
    const tokens = await acqrel(pool, (client) =>
      artblocks.getTokenImageData({ client })
    );
    console.log(`got ${tokens.length} token image URLs`);
    const chunks = [];
    async function worker() {
      while (true) {
        const workUnit = tokens.shift();
        if (workUnit == null) return;
        const { tokenId, imageUrl } = workUnit;
        try {
          const path = await images.download(rootDir, imageUrl, tokenId);
          console.log("downloaded image for %s to %s", tokenId, path);
        } catch (e) {
          console.error(`failed to download image for ${tokenId}: ${e}`);
        }
      }
    }
    await Promise.all(
      Array(NETWORK_CONCURRENCY)
        .fill()
        .map(() => worker())
    );
  });
}

async function resizeImages(args) {
  const [inputDir, outputDir, rawOutputSizePx] = args;
  const outputSizePx = Number(rawOutputSizePx);
  if (!Number.isSafeInteger(outputSizePx))
    throw new Error("bad output size: " + outputSizePx);
  await withDb(async ({ pool }) => {
    const tokenIds = await acqrel(pool, (client) =>
      artblocks.getTokenIds({ client })
    );
    console.log(`got ${tokenIds.length} token IDs`);
    const chunks = [];
    async function worker() {
      while (true) {
        const tokenId = tokenIds.shift();
        if (tokenId == null) return;
        try {
          const outputPath = await images.resize(
            inputDir,
            outputDir,
            tokenId,
            outputSizePx
          );
          if (outputPath == null) {
            console.log(
              "declined to resize image for %s (input did not exist)",
              tokenId
            );
          } else {
            console.log("resized image for %s to %s", tokenId, outputPath);
          }
        } catch (e) {
          console.error(`failed to resize image for ${tokenId}: ${e}`);
        }
      }
    }
    await Promise.all(
      Array(IMAGEMAGICK_CONCURRENCY)
        .fill()
        .map(() => worker())
    );
  });
}

async function ingestImages(args) {
  const gcs = require("@google-cloud/storage");
  let dryRun = false;
  if (args[0] === "-n" || args[0] === "--dry-run") {
    console.log("dry run mode enabled");
    dryRun = true;
    args.shift();
  }
  if (args.length !== 3) {
    console.error(
      "usage: ingest-images [-n|--dry-run] <bucket-name> <prefix> <work-dir>"
    );
    return 1;
  }
  const [bucketName, prefix, workDir] = args;
  let newTokens = adHocPromise();
  await withDb(async ({ pool }) => {
    const listenClient = await pool.connect();
    listenClient.on("notification", (n) => {
      if (n.channel !== artblocks.newTokensChannel.name) return;
      console.log("scheduling wake for new token event: %s", n.payload);
      newTokens.resolve();
    });
    await artblocks.newTokensChannel.listen(listenClient);

    console.log("collecting project scripts");
    const allScripts = await acqrel(pool, (client) =>
      artblocks.getAllProjectScripts({ client })
    );
    const generatorProjects = new Map(
      allScripts
        .filter((x) => GENERATOR_WHITELIST.includes(x.projectId))
        .map((x) => [x.projectId, { library: x.library, script: x.script }])
    );
    const ctx = {
      bucket: new gcs.Storage().bucket(bucketName),
      prefix,
      workDir,
      generatorProjects,
      dryRun,
      pool,
    };
    console.log(`listing images in gs://${ctx.bucket.name}/${ctx.prefix}`);
    const listing = await images.list(ctx.bucket, ctx.prefix);
    while (true) {
      console.log(
        dryRun
          ? "would update image progress table (skipping for dry run)"
          : "updating image progress table"
      );
      const progress = Array.from(images.listingProgress(listing)).map(
        ([k, v]) => ({
          projectId: k,
          completedThroughTokenId: v,
        })
      );
      if (!dryRun) {
        await acqrel(pool, (client) =>
          artblocks.updateImageProgress({ client, progress })
        );
      }
      console.log("fetching token IDs and download URLs");
      const tokens = await acqrel(pool, (client) =>
        artblocks.getTokenImageData({ client })
      );
      console.log(`got ${tokens.length} tokens`);
      console.log(`got images for ${listing.size} tokens`);
      await images.ingest(ctx, tokens, listing, {
        concurrency: IMAGEMAGICK_CONCURRENCY,
      });
      console.log(`sleeping for up to ${INGESTION_LATENCY_SECONDS} seconds`);
      console.log(
        await Promise.race([
          sleepMs(INGESTION_LATENCY_SECONDS * 1000).then(
            () => "woke from sleep"
          ),
          newTokens.promise.then(() => "woke from new tokens notification"),
        ])
      );
      newTokens = adHocPromise();
    }
  });
}

async function tokenFeedWss(args) {
  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 0 || port > 0xffff)
    throw new Error("expected port argument; got: " + args[0]);
  let httpServer;
  const certFile = process.env.TLS_CERT_FILE;
  const keyFile = process.env.TLS_KEY_FILE;
  if (certFile && keyFile) {
    [cert, key] = await Promise.all(
      [certFile, keyFile].map((f) => util.promisify(fs.readFile)(f))
    );
    console.log("serving over TLS");
    httpServer = https.createServer({ cert, key });
  } else {
    console.log("serving without TLS certificate");
    httpServer = http.createServer({});
  }
  const wsServer = new ws.WebSocketServer({
    server: httpServer,
    clientTracking: true,
  });
  const pool = new pg.Pool();
  await attach(wsServer, pool);
  httpServer.listen(port);
  console.log("listening on port %s", port);
}

async function generateImage(args) {
  if (args.length !== 2) {
    throw new Error("usage: generate-image <token-id> <outfile>");
  }
  const tokenId = Number(args[0]);
  if (!Number.isInteger(tokenId) || tokenId < 0)
    throw new Error("expected tokenId argument; got: " + args[0]);
  const outfile = args[1];
  const projectId = Math.floor(tokenId / 1e6);
  const { script, library, hash } = await withDb(async ({ client }) => {
    const { script, library } = await artblocks.getProjectScript({
      client,
      projectId,
    });
    const hash = await artblocks.getTokenHash({ client, tokenId });
    return { script, library, hash };
  });
  const tokenData = { tokenId: String(tokenId), hash };
  await images.generate({ script, library, tokenData }, outfile);
}

async function main() {
  require("dotenv").config();
  const [arg0, ...args] = process.argv.slice(2);
  const commands = [
    ["init", init],
    ["migrate", migrate],
    ["backfill", backfill],
    ["add-project", addProject],
    ["get-project", getProject],
    ["add-token", addToken],
    ["add-project-tokens", addProjectTokens],
    ["follow-live-mint", followLiveMint],
    ["download-images", downloadImages],
    ["resize-images", resizeImages],
    ["ingest-images", ingestImages],
    ["generate-image", generateImage],
    ["token-feed-wss", tokenFeedWss],
  ];
  for (const [name, fn] of commands) {
    if (name === arg0) {
      return await fn(args);
    }
  }
  throw "Unknown command: " + arg0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = process.exitCode || 1;
});
