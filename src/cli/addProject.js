const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const { fetchProjectData } = require("../scrape/fetchArtblocksProject");
const log = require("../util/log")(__filename);

async function addProject(args) {
  let [projectIndex, tokenContract] = args;
  if (tokenContract == null) {
    tokenContract = artblocks.artblocksContractAddress(projectIndex);
  }
  const spec = {
    projectIndex,
    tokenContract,
  };
  try {
    const project = await fetchProjectData(spec);
    if (project == null) {
      log.warn(
        `skipping phantom project ${spec.tokenContract}-${spec.projectId}`
      );
      return;
    }
    await withClient((client) =>
      artblocks.addProject({
        client,
        project,
        tokenContract: spec.tokenContract,
      })
    );
    log.info`added project ${spec.tokenContract}-${spec.projectIndex} (${project.name})`;
  } catch (e) {
    log.error`failed to add project ${spec.tokenContract}-${spec.projectIndex}: ${e}`;
    process.exitCode = 1;
    return;
  }
}

module.exports = addProject;
