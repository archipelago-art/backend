async function up({ client }) {
  await client.query(`
    ALTER TABLE traits
      ADD FOREIGN KEY (feature_id) REFERENCES features(feature_id);
  `);
}

module.exports = { up };
