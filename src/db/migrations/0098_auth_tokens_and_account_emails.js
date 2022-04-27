async function up({ client }) {
  await client.query(`
    CREATE TABLE auth_tokens (
      auth_token uuid PRIMARY KEY,
      account address NOT NULL,
      create_time timestamptz NOT NULL
    );
    CREATE INDEX auth_tokens_account ON auth_tokens(account) INCLUDE (auth_token);

    -- Active, confirmed email account associations.
    CREATE TABLE account_emails (
      account address PRIMARY KEY,
      email text NOT NULL,
      -- Time that this email association was confirmed.
      create_time timestamptz NOT NULL,
      -- This token is included with each email and can be used to unsubscribe
      -- the account.
      unsubscribe_token uuid NOT NULL,
      preferences jsonb NOT NULL,
      CONSTRAINT preferences_is_object CHECK (
        jsonb_typeof(preferences) = 'object'
      )
    );

    -- Records that we've recently sent a "please confirm your email address"
    -- email, with a nonce that can be used to complete the confirmation flow.
    --
    -- We may choose to expire these some duration after the "create_time".
    CREATE TABLE pending_email_confirmations (
      nonce uuid PRIMARY KEY,
      account address NOT NULL,
      email text NOT NULL,
      create_time timestamptz NOT NULL,
      attempt integer NOT NULL
    );
    CREATE INDEX pending_email_confirmations_account
      ON pending_email_confirmations(account);
    CREATE INDEX pending_email_confirmations_email_attempt
      ON pending_email_confirmations(email, attempt DESC)
      INCLUDE (create_time);
  `);
}

module.exports = { up };
