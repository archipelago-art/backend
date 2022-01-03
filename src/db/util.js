const crypto = require("crypto");

const ethers = require("ethers");
const pg = require("pg");

const log = require("../util/log")(__filename);

// `pg` doesn't provide much introspection: can't tell whether a client has
// been released (e.g., no event is emitted), and can't cleanly detect a
// double-release error. String matching will have to do.
const ALREADY_RELEASED =
  "Release called on client which has already been released to the pool.";
const CLIENT_CLOSED = "Client was closed and is not queryable";

function isSqlSafeIdentifier(s) {
  return !!s.match(/^[0-9A-Za-z_]+$/);
}

/**
 * Acquires a client from the pool and passes it to the given async callback,
 * awaiting and returning its result and releasing the client on the way out.
 *
 * The callback does not need to release the client, but can do so if they need
 * to dispose of it (i.e., call `client.release(true)`).
 */
async function acqrel(pool, callback) {
  const client = await pool.connect();
  let released = false;
  try {
    return await callback(client);
  } finally {
    try {
      await client.query("ROLLBACK  -- release client");
    } catch (e) {
      if ((e || {}).message !== CLIENT_CLOSED) {
        console.error("failed to roll back client: " + e);
      }
    }
    try {
      await client.release();
    } catch (e) {
      if ((e || {}).message !== ALREADY_RELEASED) {
        throw e;
      }
    }
  }
}

const SYM_CLIENT_ID = Symbol("archipelagoClientId");

class ArchipelagoClient extends pg.Client {
  constructor(...args) {
    super(...args);
    this[SYM_CLIENT_ID] = crypto.randomBytes(6).toString("base64");
  }

  async query(query, values) {
    const logging = log.trace.isEnabled();
    let ok = false;
    let start;
    if (logging) {
      start = process.hrtime.bigint();
    }
    try {
      const res = await super.query(query, values);
      ok = true;
      return res;
    } finally {
      if (logging) {
        const end = process.hrtime.bigint();
        const micros = (end - start) / 1000n;
        const millis = (Number(micros) / 1000).toFixed(3);
        const clientId = this[SYM_CLIENT_ID];
        const queryStatus = `query ${ok ? "done" : "FAIL"} in ${millis}ms`;
        const shortQuery = query
          .replace(/^ +/gm, "")
          .replace(/(?<!^)\n+/g, " ")
          .replace(/\n/g, "");
        log.trace`client ${clientId}: ${queryStatus}: ${shortQuery}`;
      }
    }
  }
}

/**
 * Opens a new pool with Archipelago middleware. Ownership of the pool is
 * transferred to the caller. Most callers should use `withPool` instead.
 */
function newPool(options = {}) {
  if (options.Client != null) {
    throw new Error("custom client conflict");
  }
  return new pg.Pool({ ...options, Client: ArchipelagoClient });
}

/*
 * Opens a new pool and passes it to the given async callback, awaiting and
 * returning its result and closing the pool on the way out.
 *
 * The callback does not need to (and should not) release the pool, but should
 * be sure that all clients eventually close, or this will deadlock.
 */
async function withPool(callback) {
  const pool = newPool();
  try {
    pool.on("connect", (client) => setDbRole(client));
    return await callback(pool);
  } catch (e) {
    log.error`withPool callback failed: ${e}`;
    throw e;
  } finally {
    await pool.end();
  }
}

async function setDbRole(client) {
  const dbRole = process.env.DB_ROLE;
  if (!dbRole) {
    log.trace`DB_ROLE is ${JSON.stringify(dbRole)}; using default authority`;
    return;
  }
  if (!isSqlSafeIdentifier(dbRole)) {
    log.warn`ignoring potentially unsafe DB_ROLE ${JSON.stringify(dbRole)}`;
    return;
  }
  // SAFETY: `dbRole` is used in identifier position and has just been checked
  // to be SQL-safe.
  log.trace`setting client authority to ${dbRole}`;
  await client.query(`SET ROLE ${dbRole}`);
}

/*
 * Async composition of `acqrel` over `withPool`: acquires a new client in a
 * new pool. Most code should use `acqrel(pool, ...)` instead; this can be used
 * as a convenience at top level when you know that you'll only need one
 * client for the lifetime of the program.
 */
async function withClient(callback) {
  return await withPool((pool) => acqrel(pool, (client) => callback(client)));
}

/**
 * Converts a string starting with "0x" to a buffer representing its contents.
 * Uses `Buffer.from` semantics: any data after the last hex byte will be
 * silently ignored (...).
 *
 * Useful for passing values to Postgres query parameters of `bytea` type.
 */
function hexToBuf(s) {
  if (typeof s !== "string" || !s.startsWith("0x"))
    throw new Error("expected 0x-string; got: " + String(s));
  return Buffer.from(s.slice(2), "hex");
}

function bufToHex(buf) {
  return "0x" + buf.toString("hex");
}

function bufToAddress(buf) {
  return ethers.utils.getAddress(bufToHex(buf));
}

module.exports = {
  acqrel,
  newPool,
  withPool,
  withClient,
  hexToBuf,
  bufToHex,
  bufToAddress,
};
