async function up({ client }) {
  await client.query(`
    CREATE FUNCTION hexaddr(zero_x_address text) RETURNS address
    IMMUTABLE
    RETURNS NULL ON NULL INPUT
    LANGUAGE SQL
    AS $$
      SELECT overlay($1 placing '\\' from 1 for 1)::bytea::address
    $$
  `);
}

module.exports = { up };
