require("dotenv").config();

const crypto = require("crypto");
const ethers = require("ethers");
const mail = require("@sendgrid/mail");

const { bufToAddress, bufToHex, hexToBuf } = require("./util");

//// Keys into the user preferences JSON object.
//
// Value: boolean, `true` to receive daily emails or `false`/absent otherwise.
const PREF_BID_EMAILS = "bidEmails";
// Value: IANA time zone string, like "America/Los_Angeles".
const PREF_EMAIL_TIMEZONE = "emailTimezone";

if (process.env.SENDGRID_TOKEN != null) {
  mail.setApiKey(process.env.SENDGRID_TOKEN);
}

const LoginRequest = [{ type: "uint256", name: "timestamp" }];
const domainSeparator = {
  name: "Archipelago",
};

async function signLoginRequest({ signer, timestamp }) {
  const msg = { timestamp };
  const types = { LoginRequest };
  return signer._signTypedData(domainSeparator, types, msg);
}

function verifyLoginRequest({ timestamp, signature }) {
  const msg = { timestamp };
  const types = { LoginRequest };
  return ethers.utils.verifyTypedData(domainSeparator, types, msg, signature);
}

async function mintAuthToken({ client, account }) {
  const res = await client.query(
    `
    INSERT INTO auth_tokens (auth_token, account, create_time)
    VALUES ($1::uuid, $2::address, now())
    RETURNING auth_token AS "authToken"
    `,
    [crypto.randomBytes(16), hexToBuf(account)]
  );
  const authToken = res.rows[0].authToken;
  return authToken;
}

// Takes a signed LoginRequest, and mints and returns an auth token.
async function signIn({ client, timestamp, signature }) {
  const account = verifyLoginRequest({ timestamp, signature });
  return await mintAuthToken({ client, account });
}

// Takes an auth token and burns it.
//
// (Maybe in the future: option to burn all auth tokens for that account?)
async function signOut({ client, authToken }) {
  const res = await client.query(
    "DELETE FROM auth_tokens WHERE auth_token = $1::uuid",
    [authToken]
  );
  return res.rowCount > 0;
}

// Authenticated method. Gets the user email address, confirmation state,
// notification preferences, etc.
async function getUserDetails({ client, authToken }) {
  const res = await client.query(
    `
    SELECT account, email, preferences
    FROM auth_tokens LEFT OUTER JOIN account_emails USING (account)
    WHERE auth_token = $1::uuid
    `,
    [authToken]
  );
  const row = res.rows[0];
  if (row == null) throw new Error("unknown auth token");
  return {
    account: bufToAddress(row.account),
    email: row.email,
    preferences: row.preferences,
  };
}

async function updatePreferences({ client, account, newPreferences }) {
  const res = await client.query(
    `
    UPDATE account_emails
    SET preferences = preferences || $2::jsonb
    WHERE account = $1::address
    `,
    [hexToBuf(account), JSON.stringify(newPreferences)]
  );
  return res.rowCount === 1;
}

// Authenticated method. Creates a new pending email confirmation.
async function setEmailUnconfirmed({
  client,
  authToken,
  email,
  sendEmail = false,
}) {
  await client.query("BEGIN");
  const accountRes = await client.query(
    "SELECT account FROM auth_tokens WHERE auth_token = $1::uuid",
    [authToken]
  );
  if (accountRes.rows.length === 0) throw new Error("unknown auth token");
  const { account } = accountRes.rows[0];
  if (email == null) {
    await client.query(
      "DELETE FROM pending_email_confirmations WHERE account = $1::address",
      [account]
    );
    await client.query(
      "DELETE FROM account_emails WHERE account = $1::address",
      [account]
    );
  } else {
    const nonceRes = await client.query(
      `
      INSERT INTO pending_email_confirmations (nonce, account, email, create_time, attempt)
      SELECT
        $1::uuid,
        $2::address,
        $3::text,
        now(),
        1 + coalesce(
          (SELECT max(attempt) FROM pending_email_confirmations WHERE email = $3::text),
          0
        )
      RETURNING nonce
      `,
      [crypto.randomBytes(16), account, email]
    );
    const { nonce } = nonceRes.rows[0];
    // TODO: send an email to the user :-)
    if (sendEmail === true) {
      await mail.send({
        from: {
          email: "noreply@archipelago.art",
          name: "Archipelago",
        },
        templateId: "d-d463363574e74103a8a4ed579f1e1aa4",
        personalizations: [
          {
            to: [{ email }],
            dynamicTemplateData: {
              address: bufToAddress(account),
              token: nonce,
            },
          },
        ],
      });
    }
  }
  await client.query("COMMIT");
}

// 1. Confirm the pending email, keyed by nonce.
// 2. Delete all other pending confirmations from the same account.
// 3. If `authToken` is not a valid auth token for that account, mint and
//    return a new auth token.
async function confirmEmail({ client, address, authToken, nonce }) {
  await client.query("BEGIN");
  const confirmationRes = await client.query(
    `
    SELECT account, email FROM pending_email_confirmations
    WHERE nonce = $1::uuid
    AND account = $2::address
    `,
    [nonce, hexToBuf(address)]
  );
  if (confirmationRes.rows.length === 0) throw new Error("invalid email nonce");
  const accountBuf = confirmationRes.rows[0].account;
  const email = confirmationRes.rows[0].email;

  await client.query(
    `
    INSERT INTO account_emails(account, email, create_time, unsubscribe_token, preferences)
    VALUES (
      $1::address,
      $2::text,
      now(),
      $3::uuid,
      '{}'::jsonb
    )
    ON CONFLICT (account) DO UPDATE
      SET email = $2::text
    `,
    [accountBuf, email, crypto.randomBytes(16)]
  );
  await client.query(
    "DELETE FROM pending_email_confirmations WHERE account = $1::address",
    [accountBuf]
  );

  const authTokenLookupRes = await client.query(
    `
    SELECT 1 FROM auth_tokens
    WHERE auth_token = $1::uuid AND account = $2::address
    `,
    [authToken, accountBuf]
  );
  let result = authToken;
  if (authTokenLookupRes.rowCount === 0) {
    result = await mintAuthToken({ client, account: bufToHex(accountBuf) });
  }
  await client.query("COMMIT");
  return result;
}

module.exports = {
  PREF_BID_EMAILS,
  PREF_EMAIL_TIMEZONE,
  signLoginRequest,
  verifyLoginRequest,
  signIn,
  signOut,
  getUserDetails,
  updatePreferences,
  setEmailUnconfirmed,
  confirmEmail,
};
