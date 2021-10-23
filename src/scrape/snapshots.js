const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const SQUIGGLES = 0;
const HYPERHASH = 11;
const ARCHETYPE = 23;
const PHANTOM_SEADRAGONS = 155;
const PROJECTS = Object.freeze([
  SQUIGGLES,
  HYPERHASH,
  ARCHETYPE,
  PHANTOM_SEADRAGONS,
]);

const HYPERHASH_DESCRIPTION =
  "HyperHash explores the possibilities of representing abstract data on Ethereum as intuitive color and geometry spaces. Focus of research are topics like geometry & symbolism. The artworks generate a futuristic, telepathic & symbolic language for Etherians. All artworks have unique colors, geometry and motion signatures live generated on your gpu through shader (GLSL) code.";
const ARCHETYPE_DESCRIPTION =
  "Archetype explores the use of repetition as a counterweight to unruly, random structures. As each single component look chaotic alone, the repetition brings along a sense of intentionality, ultimately resulting in a complex, yet satisfying expression.";

const PERFECT_CHROMATIC = 7583;
const ARCH_TRIPTYCH_1 = 23000036;
const ARCH_TRIPTYCH_2 = 23000045;
const ARCH_TRIPTYCH_3 = 23000467;
const THE_CUBE = 23000250;
const GALAXISS_ZERO = 31000000;
const BYTEBEATS_SEVEN = 38000007; // has `{"Progressions": null}` in `features`
const TOKENS = Object.freeze([
  0,
  PERFECT_CHROMATIC,
  ARCH_TRIPTYCH_1,
  ARCH_TRIPTYCH_2,
  ARCH_TRIPTYCH_3,
  THE_CUBE,
  GALAXISS_ZERO,
  BYTEBEATS_SEVEN,
]);

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

class SnapshotCache {
  constructor() {
    this._projects = new Map();
    this._tokens = new Map();
  }

  async _get(cache, resolver, key) {
    if (!cache.has(key)) {
      cache.set(key, await resolver(key));
    }
    return cache.get(key);
  }

  async project(projectId) {
    return this._get(this._projects, readProject, projectId);
  }

  async token(tokenId) {
    return this._get(this._tokens, readToken, tokenId);
  }
}

module.exports = {
  SQUIGGLES,
  HYPERHASH,
  ARCHETYPE,
  HYPERHASH_DESCRIPTION,
  ARCHETYPE_DESCRIPTION,
  PHANTOM_SEADRAGONS,
  PROJECTS,
  PERFECT_CHROMATIC,
  THE_CUBE,
  ARCH_TRIPTYCH_1,
  ARCH_TRIPTYCH_2,
  ARCH_TRIPTYCH_3,
  GALAXISS_ZERO,
  BYTEBEATS_SEVEN,
  TOKENS,
  readProject,
  readToken,
  SnapshotCache,
  locations: {
    baseDir,
    projectsDir,
    tokensDir,
    projectPath,
    tokenPath,
  },
};
