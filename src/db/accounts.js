const luxon = require("luxon");

const crypto = require("crypto");
const ethers = require("ethers");

const emails = require("./emails");
const { bufToAddress, bufToHex, hexToBuf } = require("./util");

//// Keys into the user preferences JSON object.
//
// Value: boolean, `true` to receive daily emails or `false`/absent otherwise.
const PREF_BID_EMAILS = "bidEmails";
// Value: IANA time zone string, like "America/Los_Angeles".
const PREF_EMAIL_TIME_ZONE = "emailTimeZone";

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

function verifyIanaZone(tz) {
  const zone = new luxon.IANAZone(tz);
  if (!zone.valid) throw new Error("invalid IANA time zone: " + tz);
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

// Authenticated method. Shallow-merges in new preferences.
async function updatePreferences({ client, authToken, newPreferences }) {
  if (
    typeof newPreferences !== "object" ||
    newPreferences == null ||
    Array.isArray(newPreferences)
  ) {
    throw new Error(
      "newPreferences: want object, got " + JSON.stringify(newPreferences)
    );
  }
  const okKeys = new Set([PREF_BID_EMAILS, PREF_EMAIL_TIME_ZONE]);
  const badKeys = Object.keys(newPreferences).filter((k) => !okKeys.has(k));
  if (badKeys.length > 0) {
    throw new Error("newPreferences: unknown keys: " + badKeys.join(", "));
  }
  if (newPreferences[PREF_EMAIL_TIME_ZONE] !== undefined) {
    verifyIanaZone(newPreferences[PREF_EMAIL_TIME_ZONE]);
  }
  const res = await client.query(
    `
    WITH
    this_account AS (
      SELECT account FROM auth_tokens
      WHERE auth_token = $1::uuid
    ),
    update_res AS (
      UPDATE account_emails
      SET preferences = preferences || $2::jsonb
      WHERE account = (SELECT account FROM this_account)
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM this_account) AS "authOk",
      EXISTS (SELECT 1 FROM update_res) AS "updateOk"
    `,
    [authToken, JSON.stringify(newPreferences)]
  );
  const row = res.rows[0];
  if (!row.authOk) throw new Error("unknown auth token");
  if (!row.updateOk) throw new Error("no email set");
}

async function getTimeZones({ client }) {
  const res = await client.query(
    `
    SELECT DISTINCT preferences->>$1 AS "timeZone"
    FROM account_emails
    ORDER BY preferences->>$1
    `,
    [PREF_EMAIL_TIME_ZONE]
  );
  return res.rows.map((r) => r.timeZone);
}

/**
 * Gets all users in the given time zone with `PREF_BID_EMAILS` set and last
 * email time not after `threshold`.
 */
async function getEmailableUsers({ client, timeZone, threshold }) {
  const res = await client.query(
    `
    SELECT account, email, last_email_time AS "lastEmailTime"
    FROM account_emails
    WHERE
      preferences->>$1 = $3::text
      AND preferences->$2 = 'true'::jsonb
      AND (
        last_email_time IS NULL
        OR last_email_time <= $4::timestamptz
      )
    ORDER BY last_email_time, account
    `,
    [PREF_EMAIL_TIME_ZONE, PREF_BID_EMAILS, timeZone, threshold]
  );
  return res.rows.map((r) => ({
    account: bufToAddress(r.account),
    email: r.email,
    lastEmailTime: r.lastEmailTime,
  }));
}

/**
 * Returns Ethereum account and email address details for all addresses that
 * have the `PREF_BID_EMAILS` bit set.
 */
async function getAllEmailsByTimezone({ client }) /*: Promise<Array<{
  timezone: string,
  members: Array<{
    account: address,
    email: string,
  }>,
}>> */ {
  const res = await client.query(
    `
    SELECT timezone, account, email FROM (
      SELECT preferences->>$1 AS timezone, account, email
      FROM account_emails
      WHERE preferences->$2 = 'true'::jsonb
    ) q
    ORDER BY timezone, account
    `,
    [PREF_EMAIL_TIME_ZONE, PREF_BID_EMAILS]
  );
  const result = [];
  let lastTimezone = null;
  let thisRecord = null;
  for (const row of res.rows) {
    const timezone = row.timezone;
    if (timezone !== lastTimezone) {
      lastTimezone = timezone;
      thisRecord = { timezone, members: [] };
      result.push(thisRecord);
    }
    const account = bufToAddress(row.account);
    const email = row.email;
    thisRecord.members.push({ account, email });
  }
  return result;
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
      await emails
        .prepareEmail({
          client,
          topic: "EMAIL_CONFIRMATION",
          email,
          templateId: "d-d463363574e74103a8a4ed579f1e1aa4",
          templateData: {
            address: bufToAddress(account),
            token: nonce,
          },
        })
        .then((res) => res.send());
    }
  }
  await client.query("COMMIT");
}

// 1. Confirm the pending email, keyed by nonce.
// 2. Delete all other pending confirmations from the same account.
// 3. If `authToken` is not a valid auth token for that account, mint and
//    return a new auth token. Otherwise, return `authToken`.
async function confirmEmail({ client, address, authToken, nonce, tz }) {
  await client.query("BEGIN");
  verifyIanaZone(tz);
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
      $4::jsonb
    )
    ON CONFLICT (account) DO UPDATE
      SET email = $2::text
    `,
    [
      accountBuf,
      email,
      crypto.randomBytes(16),
      JSON.stringify({ [PREF_BID_EMAILS]: false, [PREF_EMAIL_TIME_ZONE]: tz }),
    ]
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

async function touchLastEmailTime({ client, account }) {
  await client.query(
    `
    UPDATE account_emails SET last_email_time = now()
    WHERE account = $1::address
    `,
    [hexToBuf(account)]
  );
}

module.exports = {
  PREF_BID_EMAILS,
  PREF_EMAIL_TIME_ZONE,
  signLoginRequest,
  verifyLoginRequest,
  signIn,
  signOut,
  getUserDetails,
  updatePreferences,
  getTimeZones,
  getEmailableUsers,
  getAllEmailsByTimezone,
  setEmailUnconfirmed,
  confirmEmail,
  touchLastEmailTime,
};
