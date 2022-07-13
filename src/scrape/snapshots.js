const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { parseProjectData } = require("./fetchArtblocksProject");
const artblocks = require("../db/artblocks");
const { CONTRACT_ARTBLOCKS_LEGACY, CONTRACT_ARTBLOCKS_STANDARD } = artblocks;

const SQUIGGLES = { projectIndex: 0, tokenContract: CONTRACT_ARTBLOCKS_LEGACY };
const GENESIS = { projectIndex: 1, tokenContract: CONTRACT_ARTBLOCKS_LEGACY };
const ELEVATED_DECONSTRUCTIONS = {
  projectIndex: 7,
  tokenContract: CONTRACT_ARTBLOCKS_STANDARD,
}; // has no features for any token
const HYPERHASH = {
  projectIndex: 11,
  tokenContract: CONTRACT_ARTBLOCKS_STANDARD,
};
const ARCHETYPE = {
  projectIndex: 23,
  tokenContract: CONTRACT_ARTBLOCKS_STANDARD,
};
const GALAXISS = {
  projectIndex: 31,
  tokenContract: CONTRACT_ARTBLOCKS_STANDARD,
};
const BYTEBEATS = {
  projectIndex: 38,
  tokenContract: CONTRACT_ARTBLOCKS_STANDARD,
};
const PHANTOM_SEADRAGONS = {
  projectIndex: 155,
  tokenContract: CONTRACT_ARTBLOCKS_STANDARD,
};
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
function projectPath(spec) {
  return path.join(
    projectsDir(),
    spec.tokenContract,
    String(spec.projectIndex)
  );
}
function tokenPath(tokenId) {
  return path.join(tokensDir(), String(tokenId));
}

async function readProject(spec) {
  return (await promisify(fs.readFile)(projectPath(spec))).toString();
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

  async project(spec) {
    return this._get(this._projects, readProject, spec);
  }

  async token(tokenId) {
    return this._get(this._tokens, readToken, tokenId);
  }

  async addProject(client, spec) {
    const project = parseProjectData(spec, await this.project(spec));
    const projectId = await artblocks.addProject({
      client,
      project,
      tokenContract: spec.tokenContract,
    });
    return { project, projectId, spec };
  }

  async addProjects(client, artblocksProjectIndices) {
    // manual loop to ensure project ids are in order
    const result = [];
    for (const id of artblocksProjectIndices) {
      result.push(await this.addProject(client, id));
    }
    return result;
  }

  async addToken(client, artblocksTokenId) {
    const rawTokenData = await this.token(artblocksTokenId);
    const tokenId = await artblocks.addToken({
      client,
      artblocksTokenId,
      rawTokenData,
    });
    return { tokenId, artblocksTokenId, rawTokenData };
  }

  async addTokens(client, artblocksTokenIds) {
    // manual loop to ensure token ids are in order
    const result = [];
    for (const id of artblocksTokenIds) {
      result.push(await this.addToken(client, id));
    }
    return result;
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
