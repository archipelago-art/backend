// Adds a new email address to the signups list. Returns `true` if this made a
// change or `false` if the email already existed in the database. Idempotent.
async function addEmailSignup({ client, email }) {
  if (typeof email !== "string")
    throw new Error("email should be a string; got: " + email);
  const res = await client.query(
    `
    INSERT INTO email_signups(email, create_time)
    VALUES ($1, now())
    ON CONFLICT (email) DO NOTHING
    `,
    [email]
  );
  return res.rowCount > 0;
}

// Gets all email signups.
async function getEmailSignups({ client }) {
  const res = await client.query(`
    SELECT email, create_time AS "createTime" FROM email_signups
    ORDER BY email ASC
  `);
  return res.rows;
}

module.exports = {
  addEmailSignup,
  getEmailSignups,
};
