const migrationModules = [
  "./0001_projects",
  "./0002_projects_fields_not_null",
  "./0003_tokens",
  "./0004_projects_artist_name",
  // ...
];

const migrations = migrationModules.map((path) => ({
  name: path.replace(/.*\//, ""),
  migration: require(path),
}));

async function applyAll({ client, verbose }) {
  for (const { name, migration } of migrations) {
    if (verbose) console.log("--- " + name);
    await migration.up({ client, verbose });
  }
}

module.exports = { migrations, applyAll };
