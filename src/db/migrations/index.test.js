const child_process = require("child_process");
const util = require("util");

const { testDbProvider } = require("../testUtil");

const migrations = require(".");

let hasPgDump = true;
try {
  // Pardon the module-level side effect; there doesn't seem to be a way to get
  // this status to Jest later.
  child_process.execFileSync("which", ["pg_dump"]);
} catch (e) {
  hasPgDump = false;
}
function describeIfPgDump(...args) {
  if (hasPgDump) {
    return describe(...args);
  } else {
    return describe.skip(...args);
  }
}

describe("db/migrations", () => {
  const withTestDb = testDbProvider({ migrate: false });

  it(
    "applies all migrations to a fresh DB",
    withTestDb(async ({ pool }) => {
      await migrations.applyAll({ pool });
    })
  );

  describeIfPgDump("rollups", () => {
    it("yield the same database state as a from-scratch migration", async () => {
      // Call `pg_dump(1)` twice and diff its outputs rather than diffing
      // against the checked-in `rollup.sql`, which may have been generated on
      // a different machine and have different comments, etc.
      async function pgDump(database) {
        const pgDumpArgs = ["--", database];
        const res = await util.promisify(child_process.execFile)(
          "pg_dump",
          pgDumpArgs
        );
        return res.stdout;
      }

      async function canonicalizeMigrationLog({ pool }) {
        try {
          await pool.query(
            `
            UPDATE migration_log
            SET
              migration_id = updates.new_migration_id,
              timestamp = updates.new_timestamp
            FROM (
              SELECT
                migration_id AS old_migration_id,
                row_number() OVER win AS new_migration_id,
                (
                  '2001-01-01T00:00:00Z'::timestamptz
                    + make_interval(secs => row_number() OVER win)
                ) AS new_timestamp
              FROM migration_log
              WINDOW win AS (ORDER BY timestamp, name)
            ) AS updates
            WHERE migration_id = updates.old_migration_id
            `
          );
        } catch (e) {
          if (e.code === "42P01") {
            // undefined_table: migration log not yet applied.
            return;
          } else {
            throw e;
          }
        }
      }

      async function migrationState({ fromScratch }) {
        return await withTestDb(async ({ database, pool }) => {
          await migrations.applyAll({ pool, verbose: false, fromScratch });
          await canonicalizeMigrationLog({ pool });
          return await pgDump(database);
        })();
      }

      const dbFromScratch = await migrationState({ fromScratch: true });
      const dbFromRollup = await migrationState({ fromScratch: false });
      expect(dbFromRollup).toEqual(dbFromScratch);
    });
  });
});
