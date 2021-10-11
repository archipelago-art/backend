function artblocksProjectIdToCollectionName(id) {
  if (!Number.isInteger(id)) throw new Error("non-numeric project ID: " + id);
  return `ab-${id}`;
}

const RE_ARTBLOCKS_COLLECTION = /^ab-(0|[1-9][0-9]+)$/;

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
      description AS "description"
    FROM projects
    ORDER BY project_id ASC
  `);
  return res.rows.map((row) => ({
    id: artblocksProjectIdToCollectionName(row.id),
    name: row.name,
    artistName: row.artistName,
  }));
}

module.exports = {
  artblocksProjectIdToCollectionName,
  collectionNameToArtblocksProjectId,
  collections,
};
