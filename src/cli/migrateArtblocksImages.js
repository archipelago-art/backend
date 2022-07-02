const gcs = require("@google-cloud/storage");

const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const { targets } = require("../img/ingestTargets");
const Cmp = require("../util/cmp");
const log = require("../util/log")(__filename);
const parmap = require("../util/parmap");

const BATCH_SIZE = 128;

async function migrateArtblocksProject(
  oldBucket,
  newBucket,
  projectIndex,
  numTokens
) {
  const copies = [];
  for (let i = 0; i < numTokens; i++) {
    for (const { name: target } of targets()) {
      const oldName = oldObjectName(projectIndex, i, target);
      const newName = newObjectName(projectIndex, i, target);
      const oldObject = oldBucket.file(oldName);
      const newObject = newBucket.file(newName);
      copies.push({ oldObject, newObject });
    }
  }
  await parmap(BATCH_SIZE, copies, async ({ oldObject, newObject }) => {
    log.debug`${pprintObject(oldObject)} -> ${pprintObject(newObject)}`;
    await oldObject.copy(newObject);
  });
  log.info`project #${projectIndex}: copied ${copies.length} objects (${numTokens} tokens)`;
}

function pprintObject(o) {
  return `<gs://${o.bucket.name}/${o.name}>`;
}

function oldObjectName(projectIndex, tokenIndex, target) {
  const lo = String(tokenIndex % 1e3).padStart(3, "0");
  const hi = String(Math.floor(tokenIndex / 1e3)).padStart(3, "0");
  return `artblocks/${target}/${projectIndex}/${hi}/${lo}`;
}

function newObjectName(projectIndex, tokenIndex, target) {
  const tokenIndexPadded = String(tokenIndex).padStart(6, "0");
  return `tokens/${target}/artblocks/${projectIndex}/${tokenIndexPadded}`;
}

async function main(args) {
  let startProjectIndex = 0;
  if (args.length > 0) {
    const raw = args.shift();
    startProjectIndex = Number(raw);
    if (
      !Number.isInteger(startProjectIndex) ||
      String(startProjectIndex) !== raw
    ) {
      throw new Error(`bad startProjectIndex: ${raw}`);
    }
  }
  if (args.length !== 0)
    throw new Error("usage: migrate-artblocks-images [<start-project-index>]");

  const projects = await withClient(async (client) => {
    const imageProgress = await artblocks.getImageProgress({ client });
    const indices = await artblocks.artblocksProjectIndicesFromIds({
      client,
      projectIds: imageProgress.map((r) => r.projectId),
    });
    for (let i = 0; i < imageProgress.length; i++) {
      const entry = imageProgress[i];
      entry.projectIndex = indices[i];
      if (entry.projectIndex == null)
        throw new Error("missing project index: " + entry.projectId);
    }
    return imageProgress.sort(Cmp.comparing((x) => x.projectIndex));
  });

  const storage = new gcs.Storage();
  const oldBucket = storage.bucket("archipelago-images-test01");
  const newBucket = storage.bucket("archipelago");

  log.info`got ${projects.length} projects`;

  for (const project of projects) {
    const projectIndex = project.projectIndex;
    if (projectIndex < startProjectIndex) {
      log.info`skipping project #${projectIndex}`;
      continue;
    }
    const numTokens = project.completedThroughTokenIndex;
    log.info`starting project #${projectIndex}, ${numTokens} tokens`;
    await migrateArtblocksProject(
      oldBucket,
      newBucket,
      projectIndex,
      numTokens
    );
  }
}

module.exports = main;
