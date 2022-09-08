const crypto = require("crypto");

const mail = require("@sendgrid/mail");

function makeMailService() {
  if (process.env.SENDGRID_TOKEN == null) {
    throw new Error("missing SENDGRID_TOKEN environment variable");
  }
  const ms = new mail.MailService();
  ms.setApiKey(process.env.SENDGRID_TOKEN);
  return ms;
}

// Returns the email log for a given email address.
async function getLogForEmail({ client, email }) {
  const res = await client.query(
    `
    SELECT
      message_id AS "messageId",
      create_time AS "createTime",
      topic,
      to_email AS "toEmail",
      template_id AS "templateId",
      template_data AS "templateData"
    FROM email_log
    WHERE to_email = $1
    ORDER BY create_time DESC
  `,
    [email]
  );
  return res.rows;
}

// Records an email delivery in the `email_log` table, and returns a callback
// that can be invoked with `.send()` to actually send the email with SendGrid.
// The caller can send the email immediately or first wait for the transaction
// to commit, depending on which fault tolerance semantics are most
// appropriate. The callback returns a `Promise<void>`.
async function prepareEmail({
  client,
  topic,
  email,
  templateId,
  templateData,
  isTestEmail,
}) {
  if (!isTestEmail) {
    await client.query(
      `
      INSERT INTO email_log (message_id, create_time, topic, to_email, template_id, template_data)
      VALUES ($1::uuid, now(), $2::text, $3::text, $4::text, $5::jsonb)
      `,
      [
        crypto.randomBytes(16),
        topic,
        email,
        templateId,
        JSON.stringify(templateData),
      ]
    );
  }
  const send = async () => {
    if (process.env.NODE_ENV === "test") {
      throw new Error(`refusing to send email in test (topic ${topic})`);
    }
    await makeMailService().send({
      from: {
        email: "noreply@archipelago.art",
        name: "Archipelago",
      },
      templateId,
      personalizations: [
        {
          to: [{ email }],
          dynamicTemplateData: templateData,
        },
      ],
    });
  };
  return { send };
}

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
  prepareEmail,
  addEmailSignup,
  getEmailSignups,
  getLogForEmail,
};
