const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");

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

async function collections({ client }) {
  const res = await client.query(`
    SELECT
      project_id AS "id",
      name AS "name",
      artist_name AS "artistName",
      description AS "description",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      slug AS "slug"
    FROM projects
    ORDER BY project_id ASC
  `);
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

async function tokenFeatures({ client, collection }) {
  const projectId = collectionNameToArtblocksProjectId(collection);
  if (projectId == null) throw new Error("bad collection ID: " + collection);
  const minTokenId = projectId * PROJECT_STRIDE;
  const maxTokenId = minTokenId + PROJECT_STRIDE;
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      array_agg(feature_name ORDER BY feature_name ASC) AS features
    FROM tokens LEFT OUTER JOIN token_features USING (token_id)
    WHERE token_id >= $1 AND token_id < $2
    GROUP BY token_id
    ORDER BY token_id ASC
    `,
    [minTokenId, maxTokenId]
  );
  const featureNames = [];
  const featureNamesInverse = new Map();
  const tokens = {};
  for (const { tokenId, features } of res.rows) {
    const resultRow = [];
    tokens[tokenId] = resultRow;
    for (const feature of features) {
      let idx = featureNamesInverse.get(feature);
      if (idx == null) {
        idx = featureNames.length;
        featureNames.push(feature);
        featureNamesInverse.set(feature, idx);
      }
      resultRow.push(idx);
    }
  }
  return { featureNames, tokens };
}

module.exports = {
  artblocksProjectIdToCollectionName,
  collectionNameToArtblocksProjectId,
  collections,
  tokenFeatures,
};
