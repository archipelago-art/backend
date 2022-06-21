const { withClient, bufToHex } = require("../db/util");
const { downloadEventsForTokens, syncProject } = require("../opensea/download");
const {
  floorAsksByProject,
  deactivateLegacyListings,
  reingestCancellations,
} = require("../db/opensea/hacks");
const log = require("../util/log")(__filename);
const { ingestEvents } = require("../db/opensea/ingestEvents");
const { syncLoop } = require("../opensea/sync");
const {
  deleteLastUpdated,
  setLastUpdated,
  getProgress,
} = require("../db/opensea/progress");
const { projectIdForSlug } = require("../db/projects");

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

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

async function cliAddProgress(args) {
  if (args.length !== 2) {
    throw new Error("usage: add-progress <projectSlug> <openseaSlug>");
  }
  const [projectSlug, openseaSlug] = args;
  await withClient(async (client) => {
    const projectId = await projectIdForSlug({ client, slug: projectSlug });
    // We need a last updated date that will be before history starts for the project we're
    // adding. We could use OpenSea's founding date in Dec 2017, but I think it's cuter to use
    // the deployment time for the Cryptopunks contract.
    const until = new Date("2017-06-22");
    await setLastUpdated({ client, projectId, slug: openseaSlug, until });
    log.info`project ${projectSlug} now has opensea slug ${openseaSlug} (projectId: ${projectId})`;
  });
}

async function cliDeactivateLegacyListings(args) {
  if (args.length !== 0) {
    throw new Error("usage: deactivate-legacy-listings");
  }
  // OpenSea made a contract upgrade on this date which expired all previous asks.
  // https://opensea.io/blog/announcements/announcing-a-contract-upgrade/
  const deactivationDate = new Date("2022-02-18 18:03:00+00");
  await withClient(async (client) => {
    const changed = await deactivateLegacyListings({
      client,
      deactivationDate,
    });
    log.info`deactivated ${changed} asks`;
  });
}

async function cliIngestNullPriceCancellations(args) {
  if (args.length !== 0) {
    throw new Error("usage: ingest null price cancellations");
  }
  // Opensea started reporting some cancellations with null total_price but a valid
  // ending_price. We should ingest these.
  await withClient(async (client) => {
    await reingestCancellations({ client });
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
  log.info`opensea-cli: starting sync loop`;
  await withClient(async (client) => {
    await syncLoop({ apiKey, client, sleepDurationMs });
  });
}

async function cliSyncProject(args) {
  if (args.length !== 1) {
    throw new Error("usage: sync-project project-slug");
  }
  const apiKey = process.env.OPENSEA_API_KEY;
  const projectSlug = args[0];
  await withClient(async (client) => {
    const projectId = await projectIdForSlug({ client, slug: projectSlug });
    if (projectId == null) {
      throw new Error(`can't find projectId for slug: ${projectSlug}`);
    }
    const progress = (await getProgress({ client, projectId }))[0];

    if (progress == null) {
      throw new Error(`can't find opensea slug for projectId ${projectId}`);
    }
    const { slug } = progress;
    log.info`starting sync for projectId ${projectId}, opensea slug ${slug}`;
    await syncProject({ apiKey, projectId, slug, client });
  });
}

async function cli(outerArgs, self) {
  const [arg0, ...args] = outerArgs;
  const commands = [
    ["ingest-events", cliIngestEvents],
    ["download-tokens", cliDownloadTokens],
    ["clear-progress", cliClearProgress],
    ["add-progress", cliAddProgress],
    ["deactivate-legacy-listings", cliDeactivateLegacyListings],
    ["ingest-null-price-cancellations", cliIngestNullPriceCancellations],
    ["fix-floors", cliFixFloors],
    ["sync", cliSync],
    ["sync-project", cliSyncProject],
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
