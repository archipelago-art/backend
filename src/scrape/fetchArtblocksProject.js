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

function normalizeProjectIndex(projectId) {
  const result = Number.parseInt(projectId, 10);
  if (Number.isNaN(result)) throw new Error("Invalid project ID: " + projectId);
  return result;
}

async function fetchProjectText(projectSpec) {
  const payload = {
    query: GQL_PROJECT_QUERY,
    variables: {
      projectId: normalizeProjectIndex(projectSpec.projectIndex),
      contracts: [projectSpec.tokenContract.toLowerCase()],
    },
  };
  const res = await fetchWithRetries(THEGRAPH_API, {
    timeout: 5000,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.text;
}

function parseProjectData(projectSpec, text) {
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

  const projectId = normalizeProjectIndex(projectSpec.projectIndex);
  const returnedProjectId = normalizeProjectIndex(project.projectId);
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

async function fetchProjectData(projectSpec) {
  return parseProjectData(projectSpec, await fetchProjectText(projectSpec));
}

module.exports = {
  fetchProjectText,
  parseProjectData,
  fetchProjectData,
};
