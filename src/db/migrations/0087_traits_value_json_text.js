async function up({ client }) {
  await client.query(`
    -- Ideally this would just be a text column, but this stopgap gets the same
    -- data integrity and doesn't require a type-changing migration.
    ALTER TABLE traits
      ADD CONSTRAINT traits_value_jsonb_typeof_string CHECK (
        jsonb_typeof(value) = 'string'
      );
  `);
}

module.exports = { up };
