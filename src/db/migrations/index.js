const log = require("../../util/log")(__filename);

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
  // ...
];

const migrations = migrationModules.map((path) => ({
  name: path.replace(/.*\//, ""),
  migration: require(path),
}));

async function apply({ client, migrations, verbose }) {
  for (const { name, migration } of migrations) {
    if (verbose) log.info`--- ${name}`;
    await migration.up({ client, verbose });
  }
}

async function applyAll({ client, verbose }) {
  return apply({ client, migrations, verbose });
}

module.exports = { migrations, apply, applyAll };
