async function up({ client }) {
  await client.query(`
    ALTER TABLE bids
      ADD FOREIGN KEY (scope) REFERENCES bidscopes (scope);
  `);
}

module.exports = { up };
