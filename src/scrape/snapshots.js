const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const SQUIGGLES = 0;
const ARCHETYPE = 23;
const PHANTOM_SEADRAGONS = 155;
const PROJECTS = Object.freeze([SQUIGGLES, ARCHETYPE, PHANTOM_SEADRAGONS]);

const PERFECT_CHROMATIC = 7583;
const THE_CUBE = 23000250;
const TOKENS = Object.freeze([0, PERFECT_CHROMATIC, THE_CUBE]);

function baseDir() {
  return path.join(__dirname, "snapshots");
}
function projectsDir() {
  return path.join(baseDir(), "projects");
}
function tokensDir() {
  return path.join(baseDir(), "tokens");
}
function projectPath(projectId) {
  return path.join(projectsDir(), String(projectId));
}
function tokenPath(tokenId) {
  return path.join(tokensDir(), String(tokenId));
}

async function readProject(projectId) {
  return (await promisify(fs.readFile)(projectPath(projectId))).toString();
}

async function readToken(tokenId) {
  return (await promisify(fs.readFile)(tokenPath(tokenId))).toString();
}

module.exports = {
  SQUIGGLES,
  ARCHETYPE,
  PHANTOM_SEADRAGONS,
  PROJECTS,
  PERFECT_CHROMATIC,
  THE_CUBE,
  TOKENS,
  readProject,
  readToken,
  locations: {
    baseDir,
    projectsDir,
    tokensDir,
    projectPath,
    tokenPath,
  },
};
