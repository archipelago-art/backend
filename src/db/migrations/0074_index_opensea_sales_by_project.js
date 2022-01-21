async function up({ client }) {
  // This is used for the "last sale for each token in a project" query, which
  // otherwise requires a full sequential scan.
  await client.query(`
    CREATE INDEX ON opensea_sales(project_id);
  `);
}

module.exports = { up };
