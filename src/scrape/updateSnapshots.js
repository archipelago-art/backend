const fs = require("fs");
const { promisify } = require("util");

const { fetchProjectText } = require("./fetchArtblocksProject");
const { fetchTokenJsonText } = require("./fetchArtblocksToken");
const {
  PROJECTS_AND_PHANTOM_PROJECTS,
  TOKENS,
  locations,
} = require("./snapshots");

async function downloadProject(projectId) {
  const text = await fetchProjectText(projectId);
  const dest = locations.projectPath(projectId);
  await promisify(fs.writeFile)(dest, text);
}

async function downloadToken(tokenId) {
  const text = await fetchTokenJsonText(tokenId);
  const dest = locations.tokenPath(tokenId);
  await promisify(fs.writeFile)(dest, text);
}

async function main() {
  await promisify(fs.mkdir)(locations.projectsDir(), { recursive: true });
  await promisify(fs.mkdir)(locations.tokensDir(), { recursive: true });
  await Promise.all([
    ...PROJECTS_AND_PHANTOM_PROJECTS.map(downloadProject),
    ...TOKENS.map(downloadToken),
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
