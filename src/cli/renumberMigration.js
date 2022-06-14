const child_process = require("child_process");
const pathlib = require("path");

const log = require("../util/log")(__filename);

function sh(dryRun, argv) {
  log.info`${dryRun ? "would " : ""}exec: ${JSON.stringify(argv)}`;
  const [cmd, ...args] = argv;
  if (!dryRun) return child_process.execFileSync(cmd, args);
}

async function renumberMigration(args) {
  let dryRun = false;
  if (args[0] === "-n" || args[0] === "--dry-run") {
    dryRun = true;
    args.shift();
  }
  if (args.length !== 2) {
    throw new Error(
      "usage: renumber-migration [-n|--dry-run] <migration-file> <new-number>"
    );
  }
  const [oldPath, newNumberRaw] = args;
  const newNumber = Number(newNumberRaw);
  if (!Number.isInteger(newNumber))
    throw new Error("invalid new number: " + newNumberRaw);

  const migrationsDir = pathlib.join(__dirname, "..", "db", "migrations");
  const oldBasename = pathlib.basename(oldPath);
  const match = oldBasename.match(/^([0-9]{4}(_.*))\.js$/);
  if (match == null)
    throw new Error("old filename doesn't match expected format");
  const oldMigrationName = match[1];
  const newMigrationName = String(newNumber).padStart(4, "0") + match[2];
  const newBasename = newMigrationName + ".js";
  const newPath = pathlib.join(migrationsDir, newBasename);

  sh(dryRun, ["mv", "--", oldPath, newPath]);

  const inPlace = process.platform === "darwin" ? ["-i", ""] : ["-i"];
  sh(dryRun, [
    "sed",
    ...inPlace,
    "-e",
    `s#${oldMigrationName}#${newMigrationName}#g`,
    pathlib.join(migrationsDir, "index.js"),
  ]);
}

module.exports = renumberMigration;
