const slugify = require("slug");

const artblocks = require("../db/artblocks");
const opensea = require("../db/opensea");
const emails = require("../db/emails");
const { bufToAddress } = require("../db/util");
const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");
const sortAsciinumeric = require("../util/sortAsciinumeric");

const PROJECT_STRIDE = 1e6;

function artblocksProjectIdToCollectionName(id) {
  if (!Number.isInteger(id)) throw new Error("non-numeric project ID: " + id);
  return `ab-${id}`;
}
const RE_ARTBLOCKS_COLLECTION = /^ab-(0|[1-9][0-9]*)$/;

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

async function resolveProjectNewid(client, collection) {
  const index = collectionNameToArtblocksProjectIdUnwrap(collection);
  const res = await client.query(
    `
    SELECT project_id AS id FROM artblocks_projects
    WHERE artblocks_project_index = $1
    `,
    [index]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].id;
}

async function _collections({ client, projectNewid }) {
  const res = await client.query(
    `
    SELECT
      projects.project_id AS "id",
      name AS "name",
      artist_name AS "artistName",
      description AS "description",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      max_invocations AS "maxInvocations",
      slug AS "slug"
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
    id: artblocksProjectIdToCollectionName(row.id),
    name: row.name,
    artistName: row.artistName,
    description: row.description,
    aspectRatio: row.aspectRatio,
    numTokens: row.numTokens,
    maxInvocations: row.maxInvocations,
    slug: row.slug,
  }));
}

async function collections({ client }) {
  return await _collections({ client, projectNewid: null });
}

async function collection({ client, collection }) {
  const projectNewid = await resolveProjectNewid(client, collection);
  if (projectNewid == null) return null;
  const res = await _collections({ client, projectNewid });
  return res[0] ?? null;
}

async function projectFeaturesAndTraits({ client, collection }) {
  const projectNewid = await resolveProjectNewid(client, collection);
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

async function tokenFeaturesAndTraits({ client, tokenId }) {
  if (!Number.isInteger(tokenId)) throw new Error("bad token ID: " + tokenId);
  const res = await artblocks.getTokenFeaturesAndTraits({
    client,
    tokenId,
  });
  if (res.length !== 1) return [];
  return formatTokenTraits(res[0].traits);
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

async function tokenSummaries({ client, tokenIds }) {
  // HACK(@wchargin): This function will be replaced by
  // `tokenSummariesByOnChainId`, so we just transform to that input format.
  if (!Array.isArray(tokenIds))
    throw new Error("tokenSummaries: must pass array of token IDs");
  const res = await client.query(
    `
    SELECT
      token_contract AS address,
      on_chain_token_id AS "tokenId"
    FROM tokens
    WHERE token_id = ANY($1::int[])
    `,
    [tokenIds]
  );
  const tokens = res.rows.map((row) => ({
    address: bufToAddress(row.address),
    tokenId: row.tokenId,
  }));
  return await tokenSummariesByOnChainId({ client, tokens });
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

module.exports = {
  artblocksProjectIdToCollectionName,
  collectionNameToArtblocksProjectId,
  tokenNewidBySlugAndIndex,
  collections,
  collection,
  projectFeaturesAndTraits,
  tokenFeaturesAndTraits,
  tokenFeaturesAndTraitsByNewid,
  tokenSummaries,
  tokenSummariesByOnChainId,
  sortAsciinumeric,
  addEmailSignup,
  openseaSalesByProject,
};
