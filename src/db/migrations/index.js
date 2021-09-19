const migrationModules = [
  "./0001_projects",
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
