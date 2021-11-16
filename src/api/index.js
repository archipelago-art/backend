const slug = require("slug");

const artblocks = require("../db/artblocks");
const emails = require("../db/emails");
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

async function _collections({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      project_id AS "id",
      name AS "name",
      artist_name AS "artistName",
      description AS "description",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      slug AS "slug"
    FROM projects
    WHERE project_id = $1 OR $1 IS NULL
    ORDER BY project_id ASC
    `,
    [projectId]
  );
  return res.rows.map((row) => ({
    id: artblocksProjectIdToCollectionName(row.id),
    name: row.name,
    artistName: row.artistName,
    description: row.description,
    aspectRatio: row.aspectRatio,
    numTokens: row.numTokens,
    slug: row.slug,
  }));
}

async function collections({ client }) {
  return await _collections({ client, projectId: null });
}

async function collection({ client, collection }) {
  const projectId =
    collection == null
      ? null
      : collectionNameToArtblocksProjectIdUnwrap(collection);
  const res = await _collections({ client, projectId });
  return res[0] ?? null;
}

async function collectionMintState({ client, collection }) {
  const projectId = collectionNameToArtblocksProjectIdUnwrap(collection);
  const res = await client.query(
    `
    SELECT
      num_tokens AS "numTokens",
      max_invocations AS "maxInvocations"
    FROM projects
    WHERE project_id = $1
    `,
    [projectId]
  );
  return res.rows[0] ?? null;
}

async function projectFeaturesAndTraits({ client, collection }) {
  const projectId = collectionNameToArtblocksProjectIdUnwrap(collection);
  const res = await artblocks.getProjectFeaturesAndTraits({
    client,
    projectId,
  });
  for (const feature of res) {
    feature.slug = slug(feature.name);
    feature.traits = sortAsciinumeric(feature.traits, (t) => String(t.value));
    for (const trait of feature.traits) {
      trait.slug = slug(String(trait.value));
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
  const result = res[0].traits;
  for (const row of result) {
    row.featureSlug = slug(row.name);
    row.traitSlug = slug(String(row.value));
  }
  return result;
}

async function tokenSummaries({ client, tokenIds }) {
  if (!Array.isArray(tokenIds))
    throw new Error("tokenSummaries: must pass array of token IDs");
  const res = await artblocks.getTokenSummaries({ client, tokenIds });
  return res;
}

// Adds a new email address to the signups list. Returns `true` if this made a
// change or `false` if the email already existed in the database. Idempotent.
async function addEmailSignup({ client, email }) {
  return emails.addEmailSignup({ client, email });
}

module.exports = {
  artblocksProjectIdToCollectionName,
  collectionNameToArtblocksProjectId,
  collections,
  collection,
  collectionMintState,
  projectFeaturesAndTraits,
  tokenFeaturesAndTraits,
  tokenSummaries,
  sortAsciinumeric,
  addEmailSignup,
};
