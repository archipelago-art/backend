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

async function addCnf({
  client,
  clauses /** An array of arrays of traitids */,
}) {
  throw new Error("addCnf: not yet implemented");
}

module.exports = {
  canonicalForm,
  addCnf,
};
