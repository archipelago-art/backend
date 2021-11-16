async function up({ client }) {
  await client.query(`
    CREATE TABLE email_signups (
      email text PRIMARY KEY,
      create_time timestamptz
    );
  `);
}

module.exports = { up };
