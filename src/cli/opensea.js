const { withClient, bufToHex } = require("../db/util");
const {
  downloadCollection,
  downloadAllCollections,
  downloadEventsForTokens,
} = require("../opensea/download");
const { floorAsksByProject } = require("../db/opensea/hacks");
const log = require("../util/log")(__filename);
const { ingestEvents } = require("../db/opensea/ingestEvents");
const { syncLoop } = require("../opensea/sync");
const { deleteLastUpdated } = require("../db/opensea/progress");
const { projectIdForSlug } = require("../db/projects");

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

async function cliDownloadCollection(args) {
  if (args.length !== 2) {
    throw new Error(
      "usage: opensea-download-collection <collection-slug> <window-duration-days>"
    );
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const slug = args[0];
  const windowDurationMs = ONE_DAY_MS * +args[1];
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
  const windowDurationMs = ONE_DAY_MS * 30;
  await withClient(async (client) => {
    await downloadAllCollections({
      client,
      slug,
      apiKey,
      windowDurationMs,
    });
  });
}

/**
 * re-download events for tokens in a given collection.
 * If no index is provided, download events for every token in the collection.
 * If index is provided, download events for that specific token.
 */
async function cliDownloadTokens(args) {
  if (args.length < 1 || args.length > 2) {
    throw new Error("usage: download-tokens project-slug [index]");
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const slug = args[0];
  const index = args[1];
  await withClient(async (client) => {
    const projectId = await projectIdForSlug({ client, slug });
    if (projectId == null) {
      throw new Error(`can't find project id for ${slug}`);
    }

    const res = await client.query(
      `
      SELECT
        token_id AS "tokenId",
        tokens.token_contract AS "tokenContract",
        on_chain_token_id AS "onChainTokenId",
        token_index AS "tokenIndex",
        slug
      FROM tokens
      JOIN projects USING (project_id)
      WHERE tokens.project_id = $1
      AND (tokens.token_index = $2 OR $2 IS NULL)
      ORDER BY token_index ASC
        `,
      [projectId, index]
    );
    const specs = res.rows.map((x) => ({
      ...x,
      contract: bufToHex(x.tokenContract),
    }));
    await downloadEventsForTokens({ tokenSpecs: specs, apiKey, client });
  });
}

async function cliClearProgress(args) {
  if (args.length !== 1) {
    throw new Error("usage: clear-progress <projectSlug>");
  }
  const slug = args[0];
  await withClient(async (client) => {
    const projectId = await projectIdForSlug({ client, slug });
    const res = await deleteLastUpdated({ client, projectId });
    if (res) {
      log.info`cleared last-updated progress for ${slug} (project id: ${projectId})`;
    } else {
      log.info`no-op: no last-updated progress for ${slug} (project id: ${projectId})`;
    }
  });
}

async function cliFixFloors(args) {
  if (args.length > 2) {
    throw new Error("usage: fix-floors [limit] [projectSlug]");
  }
  const limitEach = args[0];
  const projectSlug = args[1];
  const apiKey = process.env.OPENSEA_API_KEY;
  await withClient(async (client) => {
    const projectId =
      projectSlug == null
        ? null
        : await projectIdForSlug({ client, slug: projectSlug });
    const projectIds = projectId == null ? null : [projectId];
    const floorTokens = await floorAsksByProject({
      client,
      projectIds,
      limitEach,
    });
    const tokenSpecs = floorTokens.map((x) => ({
      onChainTokenId: x.onChainTokenId,
      contract: x.tokenContract,
      tokenIndex: x.tokenIndex,
      slug: x.slug,
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

async function cliSync(args) {
  if (args.length > 1) {
    throw new Error("usage: sync [sleep-duration-seconds]");
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const sleepDurationSeconds = args[0] == null ? 1 : args[0];
  const sleepDurationMs = sleepDurationSeconds * 1000;
  // use a giant 1000 day window by default.
  // This is a good choice both for re-loading "fresh" projects (we'll
  // ask about events in the future, which is fine) and for quickly
  // getting the whole history on new projects (we'll pick up the whole
  // history since AB inception in a single window).
  // This is a bad choice for first-load of history rich projects; e.g.
  // if we tried to get all Fidenza history in a single giant window, we'll
  // overflow OpenSea's page limit. Thus, this parameter is tuned for the specific
  // case of auto-running sync when we've recently retrieved the whole history.
  // If you do need to load historical data for a project and the window size is an issue,
  // use the manual CLI commands to download that project in particular with a custom window
  windowDurationMs = ONE_DAY_MS;
  await withClient(async (client) => {
    await syncLoop({ apiKey, client, windowDurationMs, sleepDurationMs });
  });
}

async function cli(outerArgs, self) {
  const [arg0, ...args] = outerArgs;
  const commands = [
    ["download-collection", cliDownloadCollection],
    ["download-all-collections", cliDownloadAllCollections],
    ["ingest-events", cliIngestEvents],
    ["download-tokens", cliDownloadTokens],
    ["clear-progress", cliClearProgress],
    ["fix-floors", cliFixFloors],
    ["sync", cliSync],
  ];
  for (const [name, fn] of commands) {
    if (name === arg0) {
      return await fn(args, name);
    }
  }
  console.error(`Unknown command: ${self} ${arg0}`);
  console.error("Available commands:");
  for (const [name] of commands) {
    console.error(" ".repeat(4) + `${self} ${name}`);
  }
  process.exitCode = 1;
}

module.exports = cli;
