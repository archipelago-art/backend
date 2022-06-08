const gcs = require("@google-cloud/storage");

const artblocks = require("../db/artblocks");
const channels = require("../db/channels");
const { acqrel, withPool } = require("../db/util");
const images = require("../img");
const adHocPromise = require("../util/adHocPromise");
const log = require("../util/log")(__filename);

const IMAGEMAGICK_CONCURRENCY = 16;

const INGESTION_LATENCY_SECONDS = 15;

const GENERATOR_WHITELIST = [
  23, // Archetype
  200, // Saturazione
  206, // Asemica
];

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function ingestImages(args) {
  await withPool(async (pool) => {
    function usage() {
      console.error(
        "usage: ingest-images [-n|--dry-run] [--reingest <slug> <from-index>] <bucket-name> <prefix> <work-dir>"
      );
      return 1;
    }
    let dryRun = false;
    if (args[0] === "-n" || args[0] === "--dry-run") {
      log.info`dry run mode enabled`;
      dryRun = true;
      args.shift();
    }
    let reingest = null;
    if (args[0] === "--reingest") {
      if (args.length < 3) {
        return usage();
      }
      const [, slug, rawFromIndex] = args;
      const fromIndex = Number(rawFromIndex);
      if (!Number.isInteger(fromIndex) || fromIndex < 0) {
        return usage();
      }
      const projectId = await acqrel(pool, (client) =>
        artblocks.getProjectIdBySlug({ client, slug })
      );
      if (projectId == null) {
        throw new Error(`no such project: ${slug}`);
      }
      const artblocksProjectIndex = await acqrel(pool, async (client) => {
        const res = await artblocks.artblocksProjectIndicesFromIds({
          client,
          projectIds: [projectId],
        });
        return res[0];
      });
      if (artblocksProjectIndex == null) {
        throw new Error(`not an Art Blocks project: ${slug} (${projectId})`);
      }
      reingest = { slug, projectId, artblocksProjectIndex, fromIndex };
      log.info`reingesting ${slug} (project ID ${projectId}) from token index ${fromIndex}`;
      args.splice(0, 3);
    }
    if (args.length !== 3) {
      return usage();
    }
    const [bucketName, prefix, workDir] = args;

    let newTokens = adHocPromise();
    await acqrel(pool, async (listenClient) => {
      listenClient.on("notification", (n) => {
        if (n.channel !== channels.newTokens.name) return;
        log.info`scheduling wake for new token event: ${n.payload}`;
        newTokens.resolve();
      });
      await channels.newTokens.listen(listenClient);

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
      if (reingest) {
        const pruned = { fromOtherProjects: 0, withinProject: 0 };
        for (const k of listing.keys()) {
          const projectIndex = Math.floor(k / artblocks.PROJECT_STRIDE);
          if (projectIndex !== reingest.artblocksProjectIndex) {
            listing.delete(k);
            pruned.fromOtherProjects++;
            continue;
          }
          const tokenIndex = k % artblocks.PROJECT_STRIDE;
          if (tokenIndex >= reingest.fromIndex) {
            listing.delete(k);
            pruned.withinProject++;
            continue;
          }
        }
        log.debug`pruned ${pruned.fromOtherProjects} tokens from other projects, ${pruned.withinProject} tokens within project; remaining: ${listing.size}`;
      }
      while (true) {
        if (dryRun) {
          log.info`would update image progress table (skipping for dry run)`;
        } else if (reingest) {
          log.info`would update image progress table (skipping for reingestion)`;
        } else {
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
        const tokens = await acqrel(pool, async (client) => {
          let projectId = null;
          if (reingest) {
            projectId = await artblocks.getProjectIdBySlug({
              client,
              slug: reingest.slug,
            });
          }
          return await artblocks.getTokenImageData({ client, projectId });
        });
        log.info`got ${tokens.length} tokens`;
        log.info`got images for ${listing.size} tokens`;
        await images.ingest(ctx, tokens, listing, {
          concurrency: IMAGEMAGICK_CONCURRENCY,
          updateProgress: reingest == null,
        });
        if (reingest) {
          log.info`finished reingestion; bailing`;
          return;
        }
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

module.exports = ingestImages;
