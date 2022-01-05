const child_process = require("child_process");
const fs = require("fs");
const { join } = require("path");
const util = require("util");

const log = require("../../util/log")(__filename);
const { testDbProvider } = require("../testUtil");
const { acqrel } = require("../util");

const migrationModules = [
  "./0001_projects",
  "./0002_projects_fields_not_null",
  "./0003_tokens",
  "./0004_projects_artist_name",
  "./0005_projects_description_and_script_json",
  "./0006_projects_aspect_ratio",
  "./0007_index_token_features_token_id_feature_name",
  "./0008_tokens_project_id",
  "./0009_projects_num_tokens",
  "./0010_projects_slug",
  "./0011_features_and_traits",
  "./0012_trait_members_backfill",
  "./0013_index_trait_members_token_id",
  "./0014_deprecate_token_features",
  "./0015_drop_token_features",
  "./0016_projects_script",
  "./0017_image_progress",
  "./0018_uint256_address_types",
  "./0019_email_signups",
  "./0020_deprecate_trait_members_backfill",
  "./0021_drop_trait_members_backfill",
  "./0022_token_contract_and_on_chain_ids",
  "./0023_opensea_events_and_progress",
  "./0024_token_contract_and_on_chain_ids_not_null",
  "./0025_newids_for_tokens_projects_features_traits",
  "./0026_newids_not_null",
  "./0027_artblocks_projects",
  "./0028_opensea_slug_progress",
  "./0029_opensea_event_type",
  "./0030_opensea_event_type_not_null",
  "./0031_opensea_sale_events",
  "./0032_index_tokens_token_contract_on_chain_token_id",
  "./0033_index_tokens_project_newid_token_index",
  "./0034_token_index_int4",
  "./0035_hexaddr",
  "./0036_opensea_events_rename",
  "./0037_image_progress_newids",
  "./0038_image_progress_rekey_project_newid",
  "./0039_image_progress_retype_project_id_int8",
  "./0040_image_progress_project_id_drop_legacy_fkey",
  "./0041_image_progress_retype_project_id_projectid",
  "./0042_image_progress_project_id_fkey",
  "./0043_image_progress_rekey_project_id",
  "./0044_image_progress_drop_project_newid_and_completed_through_token_id",
  "./0045_currencies",
  "./0046_trait_and_feature_unique_child_constraints",
  "./0047_features_traits_rekey_newids",
  "./0048_features_traits_rekey_ids",
  "./0049_features_traits_legacy_newid_columns_nullable",
  "./0050_features_traits_deprecate_legacy_newid_columns",
  "./0051_features_traits_drop_legacy_newid_columns",
  "./0052_projects_rekey_project_newid",
  "./0053_projects_rekey_project_id",
  "./0054_index_tokens_project_id_token_index",
  "./0055_projects_project_newid_nullable",
  "./0056_deprecate_project_newid_columns",
  "./0057_drop_project_newid_columns",
  "./0058_index_trait_members_token_newid",
  "./0059_tokens_rekey_token_newid",
  "./0060_tokens_rekey_token_id",
  "./0061_deprecate_token_newid_columns",
  "./0062_drop_token_newid_columns",
  "./0063_trait_members_token_contract_on_chain_id_nullable",
  "./0064_drop_trait_members_token_contract_on_chain_id",
  "./0065_drop_legacy_id_sequences",
  "./0066_opensea_cleanup",
  "./0067_simplify_id_domain_constraints",
  // ...
];

const migrations = migrationModules.map((path) => ({
  name: path.replace(/.*\//, ""),
  migration: require(path),
}));

const ROLLUP_SQL_PATH = join(__dirname, "rollup.sql");
const lastMigrationInRollupName = "0065_drop_legacy_id_sequences";
const [migrationsInRollup, migrationsSinceRollup] = (() => {
  const lastIncluded = migrations.findIndex(
    (m) => m.name === lastMigrationInRollupName
  );
  const boundary = lastIncluded + 1; // works even if `lastIndex === -1`
  return [migrations.slice(0, boundary), migrations.slice(boundary)];
})();

async function apply({ client, migrations, verbose }) {
  for (const { name, migration } of migrations) {
    if (verbose) log.info`applying: ${name}`;
    await migration.up({ client, verbose });
  }
}

/*
 * Applies all migrations. Will use a rollup unless `fromScratch` is given.
 *
 * NOTE: This needs a pool instead of just a client (because it needs to
 * pollute some state on the client, like the search path, and then dispose of
 * it).
 */
async function applyAll({ pool, verbose, fromScratch = false }) {
  if (fromScratch) {
    await acqrel(pool, async (client) => {
      await apply({ client, migrations, verbose });
    });
    return;
  }
  const buf = await util.promisify(fs.readFile)(ROLLUP_SQL_PATH);
  const rollupSql = buf.toString("utf-8");
  if (verbose) {
    log.info`applying rollup of ${migrationsInRollup.length} migrations`;
  }
  await acqrel(pool, async (client) => {
    await client.query("BEGIN");
    await client.query(rollupSql);
    await client.query("COMMIT");
    // Rollup script clears out the search path; dispose of this client.
    await client.release(true);
  });
  if (verbose) {
    log.info`remaining: ${migrationsSinceRollup.length} migrations to apply after rollup`;
  }
  await acqrel(pool, async (client) => {
    await apply({ client, migrations: migrationsSinceRollup, verbose });
  });
}

async function generateRollupSql() {
  const withDb = testDbProvider({ migrate: false });
  return await withDb(async ({ database, client }) => {
    await apply({ client, migrations: migrationsInRollup, verbose: true });
    const res = await util.promisify(child_process.execFile)("pg_dump", [
      // Omit `ALTER my_table OWNER TO my_role` on every object; this dump
      // should be cluster-agnostic.
      "--no-owner",
      // Use `INSERT` instead of `COPY FROM STDIN` so that the dump is a
      // sequence of SQL statements instead of just a `psql(1)` script. (This
      // makes restores slower, but it's rare that we directly insert data in
      // migrations.)
      "--inserts",
      "--encoding=utf-8",
      "--",
      database,
    ]);
    const pgdumpSql = res.stdout;
    return [
      "--- Archipelago SQL schema rollup",
      `--- Generated: ${new Date().toISOString()}`,
      `--- Scope: ${migrationsInRollup.length} migrations, through ${lastMigrationInRollupName}`,
      "",
      pgdumpSql,
    ].join("\n");
  })();
}

Object.assign(module.exports, {
  ROLLUP_SQL_PATH,
  migrations,
  apply,
  applyAll,
  generateRollupSql,
});
