const artblocks = require("../db/artblocks");
const opensea = require("../db/opensea/legacySales");
const emails = require("../db/emails");
const { bufToAddress } = require("../db/util");
const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");
const slugify = require("../util/slugify");
const sortAsciinumeric = require("../util/sortAsciinumeric");

const PROJECT_STRIDE = 1e6;

function artblocksProjectIdToCollectionName(id) {
  if (!Number.isInteger(id)) throw new Error("non-numeric project ID: " + id);
  return `ab-${id}`;
}
const RE_ARTBLOCKS_COLLECTION = /^ab-(0|[1-9][0-9]*)$/;

const PARAM_SIZE = "{sz}";
const PARAM_INDEX_LOW = "{lo}";
const PARAM_INDEX_HIGH = "{hi}";

const IMAGE_BASE_URL = "https://img.archipelago.art";

function collectionNameToArtblocksProjectId(name) {
  const match = name.match(RE_ARTBLOCKS_COLLECTION);
  if (!match) return null;
  return Number(match[1]);
}

function collectionNameToArtblocksProjectIdUnwrap(name) {
  const projectId = collectionNameToArtblocksProjectId(name);
  if (projectId == null) throw new Error("bad collection ID: " + collection);
  return projectId;
}

async function tokenIdBySlugAndIndex({ client, slug, tokenIndex }) {
  const res = await client.query(
    `
    SELECT token_id AS id
    FROM projects JOIN tokens USING (project_id)
    WHERE projects.slug = $1 AND tokens.token_index = $2
    `,
    [slug, tokenIndex]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].id;
}

async function resolveProjectId({ client, slug }) {
  const res = await client.query(
    `
    SELECT project_id AS id FROM projects
    WHERE slug = $1
    `,
    [slug]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].id;
}

async function _collections({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      projects.project_id AS "id",
      artblocks_project_index AS "artblocksProjectIndex",
      slug AS "slug",
      name AS "name",
      artist_name AS "artistName",
      description AS "description",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      max_invocations AS "maxInvocations"
    FROM projects
    LEFT OUTER JOIN artblocks_projects USING (project_id)
    WHERE project_id = $1 OR $1 IS NULL
    ORDER BY
      artblocks_project_index ASC,
      project_id ASC
    `,
    [projectId]
  );
  return res.rows.map((row) => ({
    projectId: row.id,
    slug: row.slug,
    artblocksProjectIndex: row.artblocksProjectIndex,
    imageUrlTemplate:
      row.artblocksProjectIndex == null
        ? null
        : artblocksImageUrlTemplate(row.artblocksProjectIndex),
    name: row.name,
    artistName: row.artistName,
    description: row.description,
    aspectRatio: row.aspectRatio,
    numTokens: row.numTokens,
    maxInvocations: row.maxInvocations,
  }));
}

async function collections({ client }) {
  return await _collections({ client, projectId: null });
}

async function collection({ client, slug }) {
  const projectId = await resolveProjectId({ client, slug });
  if (projectId == null) return null;
  const res = await _collections({ client, projectId });
  return res[0] ?? null;
}

async function projectFeaturesAndTraits({ client, slug }) {
  const projectId = await resolveProjectId({ client, slug });
  if (projectId == null) return null;
  const res = await artblocks.getProjectFeaturesAndTraits({
    client,
    projectId,
  });
  for (const feature of res) {
    feature.slug = slugify(feature.name);
    feature.traits = sortAsciinumeric(feature.traits, (t) => String(t.value));
    for (const trait of feature.traits) {
      trait.slug = slugify(String(trait.value));
    }
  }
  return res;
}

async function tokenFeaturesAndTraits({ client, tokenId }) {
  if (typeof tokenId !== "string") throw new Error("bad token ID: " + tokenId);
  const res = await artblocks.getTokenFeaturesAndTraits({
    client,
    tokenId,
  });
  if (res.length !== 1) return [];
  return formatTokenTraits(res[0].traits);
}

function formatTokenTraits(result) {
  for (const row of result) {
    row.featureSlug = slugify(row.name);
    row.traitSlug = slugify(String(row.value));
  }
  return result;
}

// `tokens` should be a list of `{ address, tokenId }` pairs, where `address`
// is a "0x..." string and `tokenId` is a numeric string.
async function tokenSummariesByOnChainId({ client, tokens }) {
  if (
    !Array.isArray(tokens) ||
    !tokens.every(
      (t) => typeof t.address === "string" && typeof t.tokenId === "string"
    )
  ) {
    throw new Error(
      "tokenSummariesByOnChainId: must pass array of token addresses and IDs"
    );
  }
  const res = await artblocks.getTokenSummaries({ client, tokens });
  for (const row of res) {
    const { artblocksProjectIndex } = row;
    if (artblocksProjectIndex == null) continue;
    row.imageUrlTemplate = formatImageUrl({
      template: artblocksImageUrlTemplate(artblocksProjectIndex),
      tokenIndex: row.tokenIndex,
    });
  }
  return res;
}

// Adds a new email address to the signups list. Returns `true` if this made a
// change or `false` if the email already existed in the database. Idempotent.
async function addEmailSignup({ client, email }) {
  return emails.addEmailSignup({ client, email });
}

// Aggregates sale data on OpenSea, grouped by project
// Takes a db client and `afterDate`, as JS date; only sales that occured
// after `afterDate` are included in the aggregation.
// Returns an array of {slug, projectId, totalEthSales} objects.
// Slug is an archipelago slug and projectId is an archipelago project id.
// totalEthSales is an aggregate of ETH and WETH sales for the
// collection, represented as a BigInt amount of wei.
// Non-ETH or WETH sales are ignored.
async function openseaSalesByProject({ client, afterDate }) {
  return opensea.aggregateSalesByProject({ client, afterDate });
}

function artblocksImageUrlTemplate(artblocksProjectIndex) {
  return `${IMAGE_BASE_URL}/artblocks/${PARAM_SIZE}/${artblocksProjectIndex}/${PARAM_INDEX_HIGH}/${PARAM_INDEX_LOW}`;
}

function formatImageUrl({ template, size, tokenIndex }) {
  let result = template;
  if (size != null) {
    result = result.replace(PARAM_SIZE, size);
  }
  if (tokenIndex != null) {
    const lo = String(tokenIndex % 1000).padStart(3, "0");
    const hi = String(Math.floor(tokenIndex / 1000)).padStart(3, "0");
    result = result.replace(PARAM_INDEX_LOW, lo).replace(PARAM_INDEX_HIGH, hi);
  }
  return result;
}

module.exports = {
  artblocksProjectIdToCollectionName,
  collectionNameToArtblocksProjectId,
  tokenIdBySlugAndIndex,
  resolveProjectId,
  collections,
  collection,
  projectFeaturesAndTraits,
  tokenFeaturesAndTraits,
  tokenSummariesByOnChainId,
  sortAsciinumeric,
  addEmailSignup,
  openseaSalesByProject,
  formatImageUrl,
};
