const ethers = require("ethers");
const pg = require("pg");

const log = require("../util/log")(__filename);

// `pg` doesn't provide much introspection: can't tell whether a client has
// been released (e.g., no event is emitted), and can't cleanly detect a
// double-release error. String matching will have to do.
const ALREADY_RELEASED =
  "Release called on client which has already been released to the pool.";

/**
 * Acquires a client from the pool and passes it to the given async callback,
 * awaiting and returning its result and releasing the client on the way out.
 *
 * The callback does not need to (and should not) release the client.
 */
async function acqrel(pool, callback) {
  const client = await pool.connect();
  let released = false;
  try {
    return await callback(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch (e) {
      console.error("failed to roll back client: " + e);
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

/*
 * Opens a new pool and passes it to the given async callback, awaiting and
 * returning its result and closing the pool on the way out.
 *
 * The callback does not need to (and should not) release the pool, but should
 * be sure that all clients eventually close, or this will deadlock.
 */
async function withPool(callback) {
  const pool = new pg.Pool();
  try {
    return await callback(pool);
  } catch (e) {
    log.error`withPool callback failed: ${e}`;
    throw e;
  } finally {
    await pool.end();
  }
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
  withPool,
  withClient,
  hexToBuf,
  bufToHex,
  bufToAddress,
};
