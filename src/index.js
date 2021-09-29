const pg = require("pg");

const artblocks = require("./db/artblocks");
const migrations = require("./db/migrations");
const { acqrel } = require("./db/util");
const { fetchProjectData } = require("./scrape/fetchArtblocksProject");
const { fetchTokenData } = require("./scrape/fetchArtblocksToken");

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

async function addProject(args) {
  const [projectId] = args;
  await withDb(async ({ client }) => {
    const project = await fetchProjectData(projectId);
    await artblocks.addProject({ client, project });
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
      Array(64)
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
    ["add-project", addProject],
    ["get-project", getProject],
    ["add-token", addToken],
    ["get-features-of-token", getFeaturesOfToken],
    ["get-features-of-project", getFeaturesOfProject],
    ["add-project-tokens", addProjectTokens],
    ["get-tokens-with-feature", getTokensWithFeature],
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
