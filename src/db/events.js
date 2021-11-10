function channel(name) {
  if (typeof name !== "string") {
    throw new Error(`expected channel name string; got: ${name}`);
  }
  if (!name.match(/^[a-z_]+$/)) {
    throw new Error(`channel name may not be a SQL-safe identifier: ${name}`);
  }
  const listenSql = `LISTEN ${name}`;
  const unlistenSql = `UNLISTEN ${name}`;
  return Object.freeze({
    name,
    async listen(client) {
      return await client.query(listenSql);
    },
    async unlisten(client) {
      return await client.query(unlistenSql);
    },
    async send(client, payload) {
      return await client.query("SELECT pg_notify($1, $2)", [
        name,
        JSON.stringify(payload),
      ]);
    },
  });
}

module.exports = { channel };
