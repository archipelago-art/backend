async function up({ client }) {
  await client.query(`
    ALTER TABLE traits
      DROP CONSTRAINT traits_value_jsonb_typeof_string,
      ALTER COLUMN value TYPE text USING value->>0;
  `);
}

module.exports = { up };
