function canonicalForm(clauses) {
  if (clauses.length === 0) {
    throw new Error("empty cnf disallowed");
  }
  const cleanedClauses = clauses.map((x) => {
    if (x.length === 0) {
      throw new Error("empty clause disallowed");
    }
    const deduped = Array.from(new Set(x));
    deduped.sort();
    return deduped;
  });
  const dedupedClauses = [];
  const seen = new Set();
  for (const x of cleanedClauses) {
    const s = String(x);
    if (seen.has(s)) {
      continue;
    }
    seen.add(s);
    dedupedClauses.push(x);
  }
  dedupedClauses.sort();
  return dedupedClauses;
}

function matchesCnf(tokenTraits /*: Set<T> */, clauses /*: T[][] */) {
  return clauses.every((clause) =>
    clause.some((trait) => tokenTraits.has(trait))
  );
}

async function addCnf({
  client,
  clauses /** An array of arrays of traitids */,
}) {
  throw new Error("addCnf: not yet implemented");
}

async function projectIdForTraits(client, traits) {
  const res = await client.query(
    `
    SELECT DISTINCT project_id AS "id"
    FROM
      unnest($1::traitid[]) AS these_traits(trait_id)
      LEFT OUTER JOIN traits USING (trait_id)
      LEFT OUTER JOIN features USING (feature_id)
    LIMIT 2
    `,
    [traits]
  );
  if (res.rows.length !== 1 || res.rows[0].id == null)
    throw new Error("did not find single unique project id");
  return res.rows[0].id;
}

module.exports = {
  canonicalForm,
  addCnf,
  matchesCnf,
  projectIdForTraits,
};
