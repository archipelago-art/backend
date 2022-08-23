async function up({ client }) {
  await client.query(`
    ALTER TABLE account_emails
      ADD COLUMN last_email_time timestamptz,
      ADD CONSTRAINT account_emails_preferences_time_zone
        CHECK(jsonb_typeof(preferences->'emailTimeZone') IS NOT DISTINCT FROM 'string')
      ;
  `);
}

module.exports = { up };
