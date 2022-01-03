const fs = require("fs");
const http = require("http");
const https = require("https");
const pg = require("pg");
const util = require("util");
const ws = require("ws");
const ethers = require("ethers");

const api = require("./api/index");
const artblocks = require("./db/artblocks");
const opensea = require("./db/opensea");
const backfills = require("./db/backfills");
const migrations = require("./db/migrations");
const { acqrel, withPool, withClient } = require("./db/util");
const images = require("./img");
const {
  processOpenseaCollection,
  ingestAllCollections,
} = require("./opensea/fetcher");
const { processSales } = require("./opensea/eventProcessing");
const { fetchProjectData } = require("./scrape/fetchArtblocksProject");
const { fetchTokenData } = require("./scrape/fetchArtblocksToken");
const attach = require("./ws");
const adHocPromise = require("./util/adHocPromise");
const log = require("./util/log")(__filename);

const NETWORK_CONCURRENCY = 64;
const IMAGEMAGICK_CONCURRENCY = 16;

const INGESTION_LATENCY_SECONDS = 15;

const LIVE_MINT_INITIAL_DELAY_MS = 10 * 1000;
const LIVE_MINT_MAX_DELAY_MS = 2 * 60 * 1000;
const LIVE_MINT_BACKOFF_MULTIPLE = 1.5;
const LIVE_MINT_FANOUT = 8;

const GENERATOR_WHITELIST = [
  23, // Archetype
  200, // Saturazione
  206, // Asemica
];

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function init() {
  await withPool(async (pool) => {
    await migrations.applyAll({ pool, verbose: true });
  });
}

// usage: migrate [<migration-name> [...]]
// where each <migration-name> must be a substring of a unique migration
async function migrate(args) {
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
  await withClient(async (client) =>
    migrations.apply({
      client,
      migrations: desiredMigrations,
      verbose: true,
    })
  );
}

// usage: backfill <backfill-module-name>
// where <backfill-module-name> is the basename of a file in
// `src/db/backfills`, without the `.js` extension
async function backfill(args) {
  const [backfillName, ...backfillArgs] = args;
  const backfill = backfills[backfillName];
  if (backfill == null) throw new Error("unknown backfill " + backfillName);
  await withPool(async (pool) => {
    await backfill({ pool, args: backfillArgs, verbose: true });
  });
}

async function addProject(args) {
  const [projectId] = args;
  try {
    const project = await fetchProjectData(projectId);
    if (project == null) {
      console.warn("skipping phantom project %s", projectId);
      return;
    }
    await withClient((client) => artblocks.addProject({ client, project }));
    log.info`added project ${project.projectId} (${project.name})`;
  } catch (e) {
    log.error`failed to add project ${projectId}: ${e}`;
    process.exitCode = 1;
    return;
  }
}

async function addToken(args) {
  const [artblocksTokenId] = args;
  const token = await fetchTokenData(artblocksTokenId);
  if (!token.found) {
    log.info`token not found; nothing to add`;
    return;
  }
  const tokenId = await withClient(async (client) => {
    return await artblocks.addToken({
      client,
      artblocksTokenId,
      rawTokenData: token.raw,
    });
  });
  log.info`added Art Blocks token ${artblocksTokenId} with ID ${tokenId}`;
}

async function addProjectTokens(args) {
  const [slug] = args;
  await withPool(async (pool) => {
    const tokens = await acqrel(pool, async (client) => {
      let projectId = null;
      if (slug !== "all") {
        projectId = await artblocks.getProjectIdBySlug({ client, slug });
        if (projectId == null) {
          throw new Error(`no project with slug "${slug}"`);
        }
      }
      return await artblocks.getUnfetchedTokens({ client, projectId });
    });
    log.info`got ${tokens.length} missing tokens`;
    const artblocksProjectIndices = await acqrel(pool, async (client) => {
      const projectIdToCount = new Map();
      for (const t of tokens) {
        const k = t.projectId;
        projectIdToCount.set(k, 1 + (projectIdToCount.get(k) || 0));
      }
      const projectIds = Array.from(projectIdToCount.keys());
      const res = await artblocks.artblocksProjectIndicesFromIds({
        client,
        projectIds,
      });
      const result = new Map();
      for (let i = 0; i < projectIds.length; i++) {
        const k = projectIds[i];
        const v = res[i];
        if (v == null) {
          const n = projectIdToCount.get(k);
          log.warn`project ${k} is not an Art Blocks project; skipping ${n} tokens`;
          continue;
        }
        result.set(k, v);
      }
      return result;
    });
    const chunks = [];
    async function worker() {
      while (true) {
        const item = tokens.shift();
        if (item == null) return;
        const artblocksProjectIndex = artblocksProjectIndices.get(
          item.projectId
        );
        if (artblocksProjectIndex == null) continue;
        const artblocksTokenId =
          artblocksProjectIndex * artblocks.PROJECT_STRIDE + item.tokenIndex;
        try {
          log.debug`fetching token ${artblocksTokenId} (project ${item.projectId}, index ${item.tokenIndex})`;
          const token = await fetchTokenData(artblocksTokenId);
          if (token.found) {
            await acqrel(pool, (client) =>
              artblocks.addToken({
                client,
                artblocksTokenId,
                rawTokenData: token.raw,
              })
            );
            log.info`added token ${artblocksTokenId}`;
          } else {
            log.info`skipping token ${artblocksTokenId} (not found)`;
          }
        } catch (e) {
          log.warn`failed to add token ${artblocksTokenId}: ${e}`;
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
  const [slug] = args;
  await withPool(async (pool) => {
    const projectId = await acqrel(pool, async (client) => {
      const res = await artblocks.getProjectIdBySlug({ client, slug });
      if (res == null) {
        throw new Error(`no project with slug "${slug}"`);
      }
      return res;
    });
    let indices = await acqrel(pool, async (client) => {
      const res = await artblocks.getUnfetchedTokens({ client, projectId });
      return res.map((t) => t.tokenIndex);
    });
    const artblocksProjectIndex = await acqrel(pool, async (client) => {
      const [res] = await artblocks.artblocksProjectIndicesFromIds({
        client,
        projectIds: [projectId],
      });
      if (res == null) {
        throw new Error(`project ${slug} is not an Art Blocks project`);
      }
      return res;
    });
    const baseTokenId = artblocksProjectIndex * artblocks.PROJECT_STRIDE;

    let sleepDuration = LIVE_MINT_INITIAL_DELAY_MS;
    while (true) {
      if (indices.length === 0) {
        log.info`project ${projectId} is fully minted`;
        return;
      }
      log.info`checking for token ${indices[0]}`;
      if (
        !(await tryAddTokenLive({
          pool,
          artblocksTokenId: baseTokenId + indices[0],
        }))
      ) {
        log.info`token ${indices[0]} not ready yet; zzz ${
          sleepDuration / 1000
        }s`;
        await sleepMs(sleepDuration);
        // exponential backoff up to a limit
        sleepDuration = Math.min(
          sleepDuration * LIVE_MINT_BACKOFF_MULTIPLE,
          LIVE_MINT_MAX_DELAY_MS
        );
        continue;
      }
      // found a token, reset exponential backoff
      sleepDuration = LIVE_MINT_INITIAL_DELAY_MS;
      log.info`added token ${indices[0]}; reaching ahead`;
      indices.shift();
      const workItems = [...indices];
      let bailed = false;
      async function worker() {
        while (true) {
          if (bailed) {
            log.info`sibling task bailed; bailing`;
            return;
          }
          const tokenIndex = workItems.shift();
          if (tokenIndex == null) return;
          const artblocksTokenId = baseTokenId + tokenIndex;
          if (!(await tryAddTokenLive({ pool, artblocksTokenId }))) {
            log.info`token ${artblocksTokenId} not ready yet; bailing`;
            bailed = true;
            return;
          }
          log.info`added token ${tokenIndex}`;
          indices = indices.filter((x) => x !== tokenIndex);
        }
      }
      await Promise.all(
        Array(LIVE_MINT_FANOUT)
          .fill()
          .map(() => worker())
      );
      if (indices.length > 0) {
        log.info`going back to sleep`;
        await sleepMs(LIVE_MINT_INITIAL_DELAY_MS);
      }
    }
  });
}

async function tryAddTokenLive({ pool, artblocksTokenId }) {
  try {
    const token = await fetchTokenData(artblocksTokenId, {
      checkFeaturesPresent: true,
    });
    if (!token.found) return false;
    await acqrel(pool, (client) =>
      artblocks.addToken({
        client,
        artblocksTokenId,
        rawTokenData: token.raw,
      })
    );
    return true;
  } catch (e) {
    log.warn`failed to add token ${artblocksTokenId}: ${e}`;
    return false;
  }
}

async function ingestImages(args) {
  const gcs = require("@google-cloud/storage");
  let dryRun = false;
  if (args[0] === "-n" || args[0] === "--dry-run") {
    log.info`dry run mode enabled`;
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
  await withPool(async (pool) => {
    await acqrel(pool, async (listenClient) => {
      listenClient.on("notification", (n) => {
        if (n.channel !== artblocks.newTokensChannel.name) return;
        log.info`scheduling wake for new token event: ${n.payload}`;
        newTokens.resolve();
      });
      await artblocks.newTokensChannel.listen(listenClient);

      log.info`collecting project scripts`;
      const allScripts = await acqrel(pool, (client) =>
        artblocks.getAllProjectScripts({ client })
      );
      const generatorProjects = new Map(
        allScripts
          .filter((x) => GENERATOR_WHITELIST.includes(x.projectId))
          .map((x) => [
            x.projectId,
            {
              library: x.library,
              script: x.script,
              aspectRatio: x.aspectRatio,
            },
          ])
      );
      const ctx = {
        bucket: new gcs.Storage().bucket(bucketName),
        prefix,
        workDir,
        generatorProjects,
        dryRun,
        pool,
      };
      log.info`listing images in gs://${ctx.bucket.name}/${ctx.prefix}`;
      const listing = await images.list(ctx.bucket, ctx.prefix);
      while (true) {
        if (dryRun) {
          log.info`would update image progress table (skipping for dry run)`;
          log.info`updating image progress table`;
        }
        const listingProgress = images.listingProgress(listing);
        const projectIds = await acqrel(pool, (client) =>
          artblocks.projectIdsFromArtblocksIndices({
            client,
            indices: Array.from(listingProgress.keys()),
          })
        );
        const progress = Array.from(listingProgress).flatMap(([k, v], i) => {
          const projectId = projectIds[i];
          if (projectId == null) return [];
          const completedThroughTokenIndex = v == null ? null : v % 1e6;
          return [{ projectId, completedThroughTokenIndex }];
        });
        if (!dryRun) {
          await acqrel(pool, (client) =>
            artblocks.updateImageProgress({ client, progress })
          );
        }
        log.info`fetching token IDs and download URLs`;
        const tokens = await acqrel(pool, (client) =>
          artblocks.getTokenImageData({ client })
        );
        log.info`got ${tokens.length} tokens`;
        log.info`got images for ${listing.size} tokens`;
        await images.ingest(ctx, tokens, listing, {
          concurrency: IMAGEMAGICK_CONCURRENCY,
        });
        log.info`sleeping for up to ${INGESTION_LATENCY_SECONDS} seconds`;
        log.info`${await Promise.race([
          sleepMs(INGESTION_LATENCY_SECONDS * 1000).then(
            () => "woke from sleep"
          ),
          newTokens.promise.then(() => "woke from new tokens notification"),
        ])}`;
        newTokens = adHocPromise();
      }
    });
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
    log.info`serving over TLS`;
    httpServer = https.createServer({ cert, key });
  } else {
    log.info`serving without TLS certificate`;
    httpServer = http.createServer({});
  }
  const wsServer = new ws.WebSocketServer({
    server: httpServer,
    clientTracking: true,
  });
  await withPool(async (pool) => {
    const shutDown = await attach(wsServer, pool);
    httpServer.listen(port);
    log.info`listening on port ${port}`;
    await new Promise((res) => {
      httpServer.once("close", async () => {
        await shutDown();
        res();
      });
    });
  });
}

async function ingestOpenseaCollection(args) {
  if (args.length !== 2) {
    throw new Error(
      "usage: ingest-opensea-collection <collection-slug> <window-duration-days>"
    );
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const slug = args[0];
  const ONE_DAY = 1000 * 60 * 60 * 24;
  const windowDurationMs = ONE_DAY * +args[1];
  await withClient(async (client) => {
    await processOpenseaCollection({
      client,
      slug,
      apiKey,
      windowDurationMs,
    });
  });
}

async function ingestOpensea(args) {
  if (args.length !== 0) {
    throw new Error("usage: ingest-opensea");
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const slug = args[0];
  const ONE_DAY = 1000 * 60 * 60 * 24;
  const windowDurationMs = ONE_DAY * 30;
  await withClient(async (client) => {
    await ingestAllCollections({
      client,
      slug,
      apiKey,
      windowDurationMs,
    });
  });
}

async function processOpenseaSales(args) {
  if (args.length !== 0) {
    throw new Error("usage: process-opensea-sales");
  }
  await withClient(async (client) => {
    await processSales({ client });
  });
}

async function aggregateOpenseaSales(args) {
  if (args.length !== 0 && args.length !== 1) {
    throw new Error("usage: aggregate-opensea-sales [after-date]");
  }
  const afterDate = new Date(args[0] || "2020-11-26");
  await withClient(async (client) => {
    const totalSales = await api.openseaSalesByProject({
      client,
      afterDate,
    });
    log.info`| slug | totalSales |`;
    log.info`|------|-----------:|`;
    for (const { slug, totalEthSales } of totalSales) {
      log.info`| ${slug} | ${ethers.utils.formatUnits(totalEthSales)} |`;
    }
  });
}

async function generateImage(args) {
  if (args.length !== 3) {
    throw new Error("usage: generate-image <slug> <token-index> <outfile>");
  }
  const [slug, rawTokenIndex, outfile] = args;
  const tokenIndex = Number(rawTokenIndex);
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0)
    throw new Error("expected tokenIndex argument; got: " + args[0]);

  const { generatorData, tokenData } = await withPool(async (pool) => {
    const projectId = await acqrel(pool, async (client) => {
      const res = await artblocks.getProjectIdBySlug({ client, slug });
      if (res == null) {
        throw new Error(`no project with slug "${slug}"`);
      }
      return res;
    });
    const generatorData = await acqrel(pool, (client) =>
      artblocks.getProjectScript({
        client,
        projectId,
      })
    );

    const artblocksProjectIndex = await acqrel(pool, async (client) => {
      const [res] = await artblocks.artblocksProjectIndicesFromIds({
        client,
        projectIds: [projectId],
      });
      if (res == null) {
        throw new Error(`project ${slug} is not an Art Blocks project`);
      }
      return res;
    });
    const hash = await acqrel(pool, (client) =>
      artblocks.getTokenHash({ client, slug, tokenIndex })
    );
    const tokenId =
      artblocksProjectIndex * artblocks.PROJECT_STRIDE + tokenIndex;
    const tokenData = { tokenId, hash };

    return { generatorData, tokenData };
  });

  await images.generate(generatorData, tokenData, outfile);
}

async function main() {
  require("dotenv").config();
  const [arg0, ...args] = process.argv.slice(2);
  const commands = [
    ["init", init],
    ["migrate", migrate],
    ["backfill", backfill],
    ["add-project", addProject],
    ["add-token", addToken],
    ["add-project-tokens", addProjectTokens],
    ["follow-live-mint", followLiveMint],
    ["ingest-images", ingestImages],
    ["generate-image", generateImage],
    ["token-feed-wss", tokenFeedWss],
    ["ingest-opensea-collection", ingestOpenseaCollection],
    ["ingest-opensea", ingestOpensea],
    ["process-opensea-sales", processOpenseaSales],
    ["aggregate-opensea-sales", aggregateOpenseaSales],
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
