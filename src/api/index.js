const artblocks = require("../db/artblocks");
const opensea = require("../db/opensea");
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

async function tokenNewidBySlugAndIndex({ client, slug, tokenIndex }) {
  const res = await client.query(
    `
    SELECT token_newid AS newid
    FROM projects JOIN tokens USING (project_newid)
    WHERE projects.slug = $1 AND tokens.token_index = $2
    `,
    [slug, tokenIndex]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].newid;
}

async function resolveProjectNewid({ client, slug }) {
  const res = await client.query(
    `
    SELECT project_newid AS id FROM projects
    WHERE slug = $1
    `,
    [slug]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].id;
}

async function _collections({ client, projectNewid }) {
  const res = await client.query(
    `
    SELECT
      projects.project_newid AS "newid",
      artblocks_project_index AS "artblocksProjectIndex",
      slug AS "slug",
      name AS "name",
      artist_name AS "artistName",
      description AS "description",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      max_invocations AS "maxInvocations"
    FROM projects
    LEFT OUTER JOIN artblocks_projects
      ON projects.project_newid = artblocks_projects.project_id
    WHERE project_newid = $1 OR $1 IS NULL
    ORDER BY
      artblocks_project_index ASC,
      project_newid ASC
    `,
    [projectNewid]
  );
  return res.rows.map((row) => ({
    projectNewid: row.newid,
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
  return await _collections({ client, projectNewid: null });
}

async function collection({ client, slug }) {
  const projectNewid = await resolveProjectNewid({ client, slug });
  if (projectNewid == null) return null;
  const res = await _collections({ client, projectNewid });
  return res[0] ?? null;
}

async function projectFeaturesAndTraits({ client, slug }) {
  const projectNewid = await resolveProjectNewid({ client, slug });
  if (projectNewid == null) return null;
  const res = await artblocks.getProjectFeaturesAndTraits({
    client,
    projectNewid,
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

// `tokenId` should be the `newid` (numeric string of large integer)
async function tokenFeaturesAndTraits({ client, tokenId }) {
  return tokenFeaturesAndTraitsByNewid({ client, tokenNewid: tokenId });
}

async function tokenFeaturesAndTraitsByNewid({ client, tokenNewid }) {
  if (typeof tokenNewid !== "string")
    throw new Error("bad token ID: " + tokenNewid);
  const res = await artblocks.getTokenFeaturesAndTraits({
    client,
    tokenNewid,
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
  const lo = String(tokenIndex % 1000).padStart(3, "0");
  const hi = String(Math.floor(tokenIndex / 1000)).padStart(3, "0");
  return template
    .replace(PARAM_SIZE, size)
    .replace(PARAM_INDEX_LOW, lo)
    .replace(PARAM_INDEX_HIGH, hi);
}

module.exports = {
  artblocksProjectIdToCollectionName,
  collectionNameToArtblocksProjectId,
  tokenNewidBySlugAndIndex,
  resolveProjectNewid,
  collections,
  collection,
  projectFeaturesAndTraits,
  tokenFeaturesAndTraits,
  tokenFeaturesAndTraitsByNewid,
  tokenSummariesByOnChainId,
  sortAsciinumeric,
  addEmailSignup,
  openseaSalesByProject,
  formatImageUrl,
};
