const { withClient } = require("../db/util");
const {
  downloadCollection,
  downloadAllCollections,
  downloadEventsForTokens,
} = require("../opensea/download");
const { floorAsksByProject } = require("../db/opensea/hacks");
const log = require("../util/log")(__filename);
const { ingestEvents } = require("../db/opensea/ingestEvents");

async function cliDownloadCollection(args) {
  if (args.length !== 2) {
    throw new Error(
      "usage: opensea-download-collection <collection-slug> <window-duration-days>"
    );
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const slug = args[0];
  const ONE_DAY = 1000 * 60 * 60 * 24;
  const windowDurationMs = ONE_DAY * +args[1];
  await withClient(async (client) => {
    await downloadCollection({
      client,
      slug,
      apiKey,
      windowDurationMs,
    });
  });
}

async function cliDownloadAllCollections(args) {
  if (args.length !== 0) {
    throw new Error("usage: opensea-download-all-collections");
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const slug = args[0];
  const ONE_DAY = 1000 * 60 * 60 * 24;
  const windowDurationMs = ONE_DAY * 30;
  await withClient(async (client) => {
    await downloadAllCollections({
      client,
      slug,
      apiKey,
      windowDurationMs,
    });
  });
}

async function cliDownloadTokens(args) {
  if (args.length !== 3) {
    throw new Error("usage: download-tokens token-contract start-id end-id");
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const contract = args[0];
  const start = +args[1];
  const end = +args[2];
  const specs = [];
  for (let id = start; id < end; id++) {
    specs.push({ onChainId: String(id), contract });
  }
  await withClient(async (client) => {
    await downloadEventsForTokens({ tokenSpecs: specs, apiKey, client });
  });
}

async function cliFixFloors(args) {
  if (args.length > 2) {
    throw new Error("usage: fix-floors [limit] [projectId]");
  }
  const limitEach = args[0];
  const projectIds = args[1] == null ? null : [args[1]];
  const apiKey = process.env.OPENSEA_API_KEY;
  await withClient(async (client) => {
    const floorTokens = await floorAsksByProject({
      client,
      projectIds,
      limitEach,
    });
    const tokenSpecs = floorTokens.map((x) => ({
      onChainId: x.onChainTokenId,
      contract: x.tokenContract,
    }));
    await downloadEventsForTokens({ tokenSpecs, apiKey, client });
  });
}

async function cliIngestEvents(args) {
  if (args.length !== 0) {
    throw new Error("usage: opensea-ingest-events");
  }
  await withClient(async (client) => {
    await ingestEvents({ client });
  });
}

async function cli(outerArgs) {
  const [arg0, ...args] = outerArgs;
  const commands = [
    ["download-collection", cliDownloadCollection],
    ["download-all-collections", cliDownloadAllCollections],
    ["ingest-events", cliIngestEvents],
    ["download-tokens", cliDownloadTokens],
    ["fix-floors", cliFixFloors],
  ];
  for (const [name, fn] of commands) {
    if (name === arg0) {
      return await fn(args);
    }
  }
  console.error("Unknown command: " + arg0);
  console.error("Available commands:");
  for (const [name] of commands) {
    console.error(" ".repeat(4) + name);
  }
  process.exitCode = 1;
}

module.exports = cli;
