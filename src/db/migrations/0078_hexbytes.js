async function up({ client }) {
  await client.query(`
    CREATE FUNCTION hexbytes(zero_x_string text) RETURNS bytea
    IMMUTABLE
    RETURNS NULL ON NULL INPUT
    LANGUAGE SQL
    AS $$
      SELECT overlay($1 placing '\\' from 1 for 1)::bytea
    $$
  `);
}

module.exports = { up };
