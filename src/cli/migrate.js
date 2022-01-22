const migrations = require("../db/migrations");
const { withClient } = require("../db/util");

// usage: migrate [<migration-name> [...]]
// where each <migration-name> must be a substring of a unique migration
async function migrate(args) {
  const desiredMigrations = args.map((needle) => {
    const matches = migrations.migrations.filter((m) =>
      m.name.includes(needle)
    );
    if (matches.length === 0)
      throw new Error(`no migrations named like "${needle}"`);
    if (matches.length > 1)
      throw new Error(
        `multiple migrations named like "${needle}": ${matches
          .map((m) => m.name)
          .join(", ")}`
      );
    return matches[0];
  });
  await withClient(async (client) =>
    migrations.apply({
      client,
      migrations: desiredMigrations,
      verbose: true,
    })
  );
}

module.exports = migrate;
