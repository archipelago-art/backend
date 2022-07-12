const crypto = require("crypto");

const pg = require("pg");

const migrations = require("./migrations");
const { acqrel } = require("./util");

function generateTestDbName() {
  return "archipelago_test_" + crypto.randomBytes(8).toString("hex");
}

function testDbProvider(options = {}) {
  const migrate = !!(options.migrate ?? true);
  const templateConnInfo = { ...options.templateConnInfo };
  /**
   * Decorates a function (typically a test case) to take an additional first
   * argument, which includes a connection pool to a newly created database
   * that will automatically be torn down once the function completes.
   *
   * Specifically, the first argument to the decorated function is an object
   * with fields `pool` (a `pg.Pool`), `client` (a `pg.Client` from the same
   * pool, for convenience; this will be automatically released), and
   * `database` (a string; the name of the temporary database).
   *
   * The decorated function must be sure to release all clients that it
   * acquires on the given pool. The `acqrel` function from `./util` may help.
   */
  return function withDb(callback) {
    return async (...args) => {
      async function makeTemplateClient() {
        const client = new pg.Client(this._templateConnInfo);
        await client.connect();
        const res = await client.query("SELECT inet_server_addr() AS addr");
        const serverAddr = res.rows[0].addr;
        if (serverAddr != null && serverAddr !== "127.0.0.1") {
          await client.end();
          throw new Error("refusing to run tests on remote host " + serverAddr);
        }
        return client;
      }

      const database = await generateTestDbName();

      const client = await makeTemplateClient();
      // Identifiers generated by `generateTestDbName` are always SQL-safe.
      await client.query(`CREATE DATABASE ${database}`);
      await client.end();

      async function drop() {
        const client = await makeTemplateClient();
        await client.query(`DROP DATABASE ${database}`);
        await client.end();
      }

      const pool = new pg.Pool({ ...templateConnInfo, database });
      try {
        return await acqrel(pool, async (client) => {
          if (migrate) await migrations.applyAll({ pool });
          return await callback({ database, pool, client }, ...args);
        });
      } finally {
        if (!pool.ended) {
          await pool.end();
        }
        await drop();
      }
    };
  };
}

module.exports = { testDbProvider };
