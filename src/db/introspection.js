async function tableExists({ client, schema = "public", table }) {
  const res = await client.query(
    `
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = $2
    `,
    [schema, table]
  );
  return res.rowCount > 0;
}

async function columnExists({ client, schema = "public", table, column }) {
  const res = await client.query(
    `
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
    `,
    [schema, table, column]
  );
  return res.rowCount > 0;
}

module.exports = {
  tableExists,
  columnExists,
};
