const htmlParser = require("node-html-parser");

const { fetchWithRetries } = require("./retryFetch");

const PROJECT_URL_BASE = "https://api.artblocks.io/project";

function normalizeProjectId(projectId) {
  const result = Number.parseInt(projectId, 10);
  if (Number.isNaN(result)) throw new Error("Invalid project ID: " + projectId);
  return result;
}

async function fetchProjectHtml(projectId) {
  const url = `${PROJECT_URL_BASE}/${normalizeProjectId(projectId)}`;
  return (await fetchWithRetries(url, { timeout: 5000 })).text;
}

function parseProjectData(projectId, html) {
  const body = htmlParser.parse(html);
  return {
    projectId: normalizeProjectId(projectId),
    name: findByInnerText(body, "h1", /^Name: (.*)$/)[1],
    maxInvocations: Number.parseInt(
      findByInnerText(body, "p", /^Maximum Invocations: ([0-9]+)$/)[1],
      10
    ),
  };
}

function findByInnerText(root, selector, re) {
  const matches = [];
  for (const el of root.querySelectorAll(selector)) {
    const match = el.innerText.match(re);
    if (match) matches.push(match);
  }
  if (matches.length === 0) throw new Error(`no matches for ${re}`);
  if (matches.length > 1)
    throw new Error(`multiple matches for ${re}: ${matches.join("; ")}`);
  return matches[0];
}

async function fetchProjectData(projectId) {
  return parseProjectData(projectId, await fetchProjectHtml(projectId));
}

module.exports = {
  fetchProjectHtml,
  parseProjectData,
  fetchProjectData,
};
