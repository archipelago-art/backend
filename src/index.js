const pg = require("pg");

const artblocks = require("./db/artblocks");
const migrations = require("./db/migrations");
const { acqrel } = require("./db/util");
const { downloadImage } = require("./scrape/downloadImages");
const { fetchProjectData } = require("./scrape/fetchArtblocksProject");
const { fetchTokenData } = require("./scrape/fetchArtblocksToken");

const NETWORK_CONCURRENCY = 64;

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

async function getFeaturesOfToken(args) {
  const [tokenId] = args;
  await withDb(async ({ client }) => {
    const features = await artblocks.getTokenFeatures({ client, tokenId });
    for (const feature of features) console.log(feature);
  });
}

async function getFeaturesOfProject(args) {
  const projectId = Number(args[0]);
  await withDb(async ({ client }) => {
    const features = await artblocks.getProjectFeatures({
      client,
      projectId,
    });
    for (const feature of features) console.log(feature);
  });
}

async function getTokensWithFeature(args) {
  const projectId = Number(args[0]);
  const featureName = args[1];
  await withDb(async ({ client }) => {
    const tokenIds = await artblocks.getTokensWithFeature({
      client,
      projectId,
      featureName,
    });
    for (const tokenId of tokenIds) console.log(String(tokenId));
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

async function downloadImages(args) {
  const [rootDir] = args;
  await withDb(async ({ pool }) => {
    const tokens = await acqrel(pool, (client) =>
      artblocks.getTokenImageUrls({ client })
    );
    console.log(`got ${tokens.length} token image URLs`);
    const chunks = [];
    async function worker() {
      while (true) {
        const workUnit = tokens.shift();
        if (workUnit == null) return;
        const { tokenId, imageUrl } = workUnit;
        try {
          const path = await downloadImage(rootDir, imageUrl, tokenId);
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

async function main() {
  require("dotenv").config();
  const [arg0, ...args] = process.argv.slice(2);
  const commands = [
    ["init", init],
    ["migrate", migrate],
    ["add-project", addProject],
    ["get-project", getProject],
    ["add-token", addToken],
    ["get-features-of-token", getFeaturesOfToken],
    ["get-features-of-project", getFeaturesOfProject],
    ["add-project-tokens", addProjectTokens],
    ["get-tokens-with-feature", getTokensWithFeature],
    ["download-images", downloadImages],
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
