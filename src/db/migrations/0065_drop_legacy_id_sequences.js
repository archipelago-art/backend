async function up({ client }) {
  await client.query(`
    DROP SEQUENCE features_feature_id_seq;
    DROP SEQUENCE traits_trait_id_seq;
  `);
}

module.exports = { up };
