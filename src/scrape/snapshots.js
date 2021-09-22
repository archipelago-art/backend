const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const PROJECTS = Object.freeze([0, 23]);
const TOKENS = Object.freeze([0, 7583, 23000250]);

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
  PROJECTS,
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
