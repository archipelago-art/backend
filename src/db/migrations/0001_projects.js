async function up({ client }) {
  await client.query(`
    CREATE TABLE projects (
      -- Art Blocks project ID, like "23" for Archetype.
      project_id INTEGER PRIMARY KEY,
      name TEXT,
      -- The mint cap: the project will only ever have this many tokens.
      max_invocations INTEGER
    );
  `);
}

module.exports = { up };
