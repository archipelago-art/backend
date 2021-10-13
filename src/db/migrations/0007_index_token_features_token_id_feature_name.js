async function up({ client }) {
  await client.query(`
    CREATE INDEX token_features_token_id_feature_name
      ON token_features(token_id, feature_name);
  `);
}

module.exports = { up };
