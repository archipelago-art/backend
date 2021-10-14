async function up({ client }) {
  await client.query(`
    BEGIN;
    ALTER TABLE projects ADD COLUMN slug TEXT UNIQUE;
    CREATE INDEX projects_slug ON projects(slug);
    COMMIT;
  `);
}

module.exports = { up };
