const pg = require("pg");

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
      await client.release();
    } catch (e) {
      if ((e || {}).message !== ALREADY_RELEASED) {
        throw e;
      }
    }
  }
}

module.exports = { acqrel };
