const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const { fetchProjectData } = require("../scrape/fetchArtblocksProject");
const log = require("../util/log")(__filename);

async function addProject(args) {
  const [projectId] = args;
  try {
    const project = await fetchProjectData(projectId);
    if (project == null) {
      console.warn("skipping phantom project %s", projectId);
      return;
    }
    await withClient((client) => artblocks.addProject({ client, project }));
    log.info`added project ${project.projectId} (${project.name})`;
  } catch (e) {
    log.error`failed to add project ${projectId}: ${e}`;
    process.exitCode = 1;
    return;
  }
}

module.exports = addProject;
