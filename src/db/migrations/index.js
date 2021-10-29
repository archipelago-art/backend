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
  // ...
];

const migrations = migrationModules.map((path) => ({
  name: path.replace(/.*\//, ""),
  migration: require(path),
}));

async function apply({ client, migrations, verbose }) {
  for (const { name, migration } of migrations) {
    if (verbose) console.log("--- " + name);
    await migration.up({ client, verbose });
  }
}

async function applyAll({ client, verbose }) {
  return apply({ client, migrations, verbose });
}

module.exports = { migrations, apply, applyAll };
