const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const SQUIGGLES = 0;
const GENESIS = 1;
const ELEVATED_DECONSTRUCTIONS = 7; // has no features for any token
const HYPERHASH = 11;
const ARCHETYPE = 23;
const GALAXISS = 31;
const BYTEBEATS = 38;
const PHANTOM_SEADRAGONS = 155;
const PROJECTS = Object.freeze([
  SQUIGGLES,
  GENESIS,
  ELEVATED_DECONSTRUCTIONS,
  HYPERHASH,
  ARCHETYPE,
  GALAXISS,
  BYTEBEATS,
]);
const PROJECTS_AND_PHANTOM_PROJECTS = Object.freeze([
  ...PROJECTS,
  PHANTOM_SEADRAGONS,
]);

const HYPERHASH_DESCRIPTION =
  "HyperHash explores the possibilities of representing abstract data on Ethereum as intuitive color and geometry spaces. Focus of research are topics like geometry & symbolism. The artworks generate a futuristic, telepathic & symbolic language for Etherians. All artworks have unique colors, geometry and motion signatures live generated on your gpu through shader (GLSL) code.\n";
const ARCHETYPE_DESCRIPTION =
  "Archetype explores the use of repetition as a counterweight to unruly, random structures. As each single component look chaotic alone, the repetition brings along a sense of intentionality, ultimately resulting in a complex, yet satisfying expression.";

const PERFECT_CHROMATIC = 7583;
const GENESIS_ZERO = 1000000;
const ELEVATED_DECONSTRUCTIONS_EMPTY_FEATURES = 7000000;
const ARCH_TRIPTYCH_1 = 23000036;
const ARCH_TRIPTYCH_2 = 23000045;
const ARCH_TRIPTYCH_3 = 23000467;
const ARCH_66 = 23000066;
const THE_CUBE = 23000250;
const GALAXISS_FEATURES_ARRAY = 31000000;
const BYTEBEATS_NULL_FEATURE = 38000007; // has `{"Progressions": null}` in `features`
const BYTEBEATS_EMPTY_FEATURES = 38000212; // empty `features`, presumably due to Art Blocks bug
const TOKENS = Object.freeze([
  0,
  GENESIS_ZERO,
  PERFECT_CHROMATIC,
  ELEVATED_DECONSTRUCTIONS_EMPTY_FEATURES,
  ARCH_TRIPTYCH_1,
  ARCH_TRIPTYCH_2,
  ARCH_TRIPTYCH_3,
  ARCH_66,
  THE_CUBE,
  GALAXISS_FEATURES_ARRAY,
  BYTEBEATS_NULL_FEATURE,
  BYTEBEATS_EMPTY_FEATURES,
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
  GENESIS,
  ELEVATED_DECONSTRUCTIONS,
  HYPERHASH,
  ARCHETYPE,
  HYPERHASH_DESCRIPTION,
  ARCHETYPE_DESCRIPTION,
  GALAXISS,
  BYTEBEATS,
  PHANTOM_SEADRAGONS,
  PROJECTS,
  PROJECTS_AND_PHANTOM_PROJECTS,
  PERFECT_CHROMATIC,
  GENESIS_ZERO,
  ELEVATED_DECONSTRUCTIONS_EMPTY_FEATURES,
  THE_CUBE,
  ARCH_TRIPTYCH_1,
  ARCH_TRIPTYCH_2,
  ARCH_TRIPTYCH_3,
  ARCH_66,
  GALAXISS_FEATURES_ARRAY,
  BYTEBEATS_NULL_FEATURE,
  BYTEBEATS_EMPTY_FEATURES,
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
