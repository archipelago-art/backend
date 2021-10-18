async function up({ client }) {
  await client.query(`
    BEGIN;
    ALTER TABLE projects ADD COLUMN slug text UNIQUE;
    CREATE INDEX projects_slug ON projects(slug);
    COMMIT;
  `);
}

module.exports = { up };
