async function up({ client }) {
  await client.query(`
    ALTER TABLE token_features RENAME TO deprecated_token_features;
  `);
}

async function down({ client }) {
  await client.query(`
    ALTER TABLE deprecated_token_features RENAME TO token_features;
  `);
}

module.exports = { up, down };
