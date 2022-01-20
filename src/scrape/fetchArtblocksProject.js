const { fetchWithRetries } = require("./retryFetch");

const THEGRAPH_API =
  "https://api.thegraph.com/subgraphs/name/artblocks/art-blocks";

const GQL_PROJECT_QUERY = `
query GetProject($projectId: Int!, $contracts: [String!]) {
  projects(where: { projectId: $projectId, contract_in: $contracts }) {
    projectId
    name
    description
    artistName
    scriptJson: scriptJSON
    maxInvocations
    script
  }
}
`;

// These must be all lowercase.
const CONTRACT_ARTBLOCKS_LEGACY = "0x059edd72cd353df5106d2b9cc5ab83a52287ac3a";
const CONTRACT_ARTBLOCKS_STANDARD =
  "0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270";

function normalizeProjectId(projectId) {
  const result = Number.parseInt(projectId, 10);
  if (Number.isNaN(result)) throw new Error("Invalid project ID: " + projectId);
  return result;
}

async function fetchProjectText(projectId) {
  const payload = {
    query: GQL_PROJECT_QUERY,
    variables: {
      projectId: normalizeProjectId(projectId),
      contracts: [CONTRACT_ARTBLOCKS_LEGACY, CONTRACT_ARTBLOCKS_STANDARD],
    },
  };
  const res = await fetchWithRetries(THEGRAPH_API, {
    timeout: 5000,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.text;
}

function parseProjectData(projectId, text) {
  const json = JSON.parse(text);
  if (
    typeof json !== "object" ||
    typeof json.data !== "object" ||
    !Array.isArray(json.data.projects)
  ) {
    throw new Error("unexpected JSON response: " + JSON.stringify(json));
  }
  const projects = json.data.projects;

  if (projects.length === 0) return null;
  if (projects.length > 1) {
    throw new Error("multiple matches: " + JSON.stringify(json));
  }
  const project = projects[0];

  projectId = normalizeProjectId(projectId);
  const returnedProjectId = normalizeProjectId(project.projectId);
  if (projectId !== returnedProjectId) {
    throw new Error(
      `wrong project: ` +
        `${JSON.stringify(returnedProjectId)} !== ${JSON.stringify(projectId)}`
    );
  }

  const { description, artistName } = project;
  if ((artistName || "").length === 0 && (description || "").length === 0) {
    // Projects like 128 and 155 appear to be abandoned drafts or something.
    // They have obscenely high invocation counts but no actual data or tokens.
    return null;
  }

  return {
    projectId: returnedProjectId,
    artistName,
    description,
    scriptJson: project.scriptJson,
    name: project.name,
    maxInvocations: Number.parseInt(project.maxInvocations, 10),
    script: project.script,
  };
}

function findByInnerText(root, selector, re) {
  const matches = [];
  for (const el of root.querySelectorAll(selector)) {
    const match = el.text.match(re);
    if (match) matches.push(match);
  }
  if (matches.length === 0) throw new Error(`no matches for ${re}`);
  if (matches.length > 1)
    throw new Error(`multiple matches for ${re}: ${matches.join("; ")}`);
  return matches[0];
}

async function fetchProjectData(projectId) {
  return parseProjectData(projectId, await fetchProjectText(projectId));
}

module.exports = {
  fetchProjectText,
  parseProjectData,
  fetchProjectData,
};
