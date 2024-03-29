const child_process = require("child_process");
const crypto = require("crypto");
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
  "./0068_opensea_redone",
  "./0069_opensea_asks_index",
  "./0070_erc_721_transfers",
  "./0071_opensea_progress_project_id",
  "./0072_opensea_progress_primary_key",
  "./0073_drop_opensea_transfers",
  "./0074_index_opensea_sales_by_project",
  "./0075_bidid_askid",
  "./0076_migration_log",
  "./0077_bytes32",
  "./0078_hexbytes",
  "./0079_eth_blocks",
  "./0080_transfers_block_hash_bytes",
  "./0081_transfers_block_hash_nullable",
  "./0082_transfers_block_hash_bytes32",
  "./0083_transfers_block_hash_bytes_nullable",
  "./0084_transfers_drop_block_hash_bytes",
  "./0085_signature_type",
  "./0086_index_erc_721_transfers_hom",
  "./0087_traits_value_json_text",
  "./0088_traits_value_text",
  "./0089_ab_concept_migrations",
  "./0090_ab_concept_cleanup",
  "./0091_ab_fetch_time",
  "./0092_tokens_fetch_time_nullable",
  "./0093_tokens_drop_fetch_time",
  "./0094_projects_slug_not_null",
  "./0095_projects_image_template",
  "./0096_projects_image_template_not_null",
  "./0097_opensea_cancellations",
  "./0098_auth_tokens_and_account_emails",
  "./0099_archipelago_orderbook",
  "./0100_bidscopes_forwarding_table",
  "./0101_bids_scope_fkey",
  "./0102_traits_features_foreign_key",
  "./0103_eth_blocks_rename_to_eth_blocks1",
  "./0104_eth_events",
  "./0105_eth_blocks_semi_nullable_parent_hash",
  "./0106_eth_blocks_parent_hash_self_fkey",
  "./0107_index_eth_blocks_parent_hash",
  "./0108_index_erc_721_transfers_to_address_from_address",
  "./0109_eth_blocks_remove_nonzero_parent_hash_constraint",
  "./0110_artblocks_tokens_token_id_fkey",
  "./0111_token_traits_queue",
  "./0112_new_erc721_transfers",
  "./0113_erc721_transfers_adjust_unique_constraint",
  "./0114_index_erc721_transfers_to_address_and_from_address",
  "./0115_websocket_log",
  "./0116_fix_index_erc721_transfers_from_address",
  "./0117_deprecate_legacy_chain_tracking",
  "./0118_fine_grained_activity_fields",
  "./0119_fine_grained_activity_constraints",
  "./0120_index_bids_asks_account_nonce",
  "./0121_on_chain_nonce_cancellations",
  "./0122_on_chain_fills",
  "./0123_fills_rename_currency_to_currency_id",
  "./0124_data_oriented_jobs",
  "./0125_jobs_type_and_args_not_null",
  "./0126_erc20_balances",
  "./0127_drop_legacy_chain_tracking",
  "./0128_artblocks_projects_token_contract",
  "./0129_artblocks_projects_token_contract_cleanup",
  "./0130_image_ingestion_queue",
  "./0131_artblocks_project_index_not_unique",
  "./0132_token_rarity",
  "./0133_account_emails_time_zone_and_last_email_time",
  "./0134_artacle_projects",
  "./0135_email_log",
  // ...
];

const migrations = migrationModules.map((path) => ({
  name: path.replace(/.*\//, ""),
  migration: require(path),
}));

const ROLLUP_SQL_PATH = join(__dirname, "rollup.sql");
const lastMigrationInRollupName = "0127_drop_legacy_chain_tracking";
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
    // Best-effort attempt to apply migration plus log entry in the same
    // transaction, but if the migration script commits, there's nothing we can
    // do about it. That's okay.
    await client.query("BEGIN");
    await migration.up({ client, verbose });
    await client.query("BEGIN"); // in case client committed
    await client.query("SAVEPOINT migration_applied");
    try {
      const migrationId = crypto.randomBytes(8).readBigUint64LE() >> 1n;
      const blobHash = await migrationBlobHash(name);
      await client.query(
        `
        INSERT INTO migration_log (migration_id, name, timestamp, blob_hash)
        VALUES ($1, $2, now(), $3)
        `,
        [migrationId, name, blobHash]
      );
    } catch (e) {
      // 42P01 "undefined_table" fires when running a migration earlier than
      // the migration that creates the `migration_log` table. Nothing to do.
      if (e.code === "42P01") {
        await client.query("ROLLBACK TO migration_applied");
      } else {
        throw e;
      }
    }
    await client.query("COMMIT");
  }
}

// Returns a buffer with the SHA-1 hash of `"blob %d\0%s" % (buf.length, buf)`,
// where `buf` is the file contents of the migration with the given name. This
// coincides with `git hash-object -t blob MIGRATION_FILE`.
async function migrationBlobHash(name) {
  const filename = join(__dirname, `${name}.js`);
  const contents = await util.promisify(fs.readFile)(filename);
  const hasher = crypto.createHash("sha1"); // per Git
  hasher.update(`blob ${contents.length}\0`, "utf-8");
  hasher.update(contents);
  return hasher.digest();
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
    if (typeof database !== "string" || !database.match(/^[a-z_][a-z0-9_]*$/)) {
      throw new Error(
        `database name may not be a SQL-safe identifier: ${database}`
      );
    }
    await client.query(`ALTER DATABASE ${database} SET timezone TO 'UTC'`);
    await apply({ client, migrations: migrationsInRollup, verbose: true });
    await canonicalizeMigrationLog({ client });
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

// Canonicalize nondeterministic data in the migration log (if it exists).
async function canonicalizeMigrationLog({ client }) {
  try {
    await client.query(
      `
      UPDATE migration_log
      SET
        migration_id = updates.new_migration_id,
        timestamp = updates.new_timestamp
      FROM (
        SELECT
          migration_id AS old_migration_id,
          (
            'x0' ||
            substring(sha256((row_number() OVER win)::text::bytea)::text from 3)
          )::bit(64)::int8 AS new_migration_id,
          (
            '2001-01-01T00:00:00Z'::timestamptz
              + make_interval(secs => row_number() OVER win)
          ) AS new_timestamp
        FROM migration_log
        WINDOW win AS (ORDER BY timestamp, name)
      ) AS updates
      WHERE migration_id = updates.old_migration_id
      `
    );
  } catch (e) {
    if (e.code === "42P01") {
      // undefined_table: migration log not yet applied.
      return;
    } else {
      throw e;
    }
  }
}

Object.assign(module.exports, {
  ROLLUP_SQL_PATH,
  migrations,
  apply,
  applyAll,
  generateRollupSql,
  canonicalizeMigrationLog,
});
