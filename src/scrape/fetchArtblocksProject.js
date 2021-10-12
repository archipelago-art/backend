const htmlParser = require("node-html-parser");

const { fetchWithRetries } = require("./retryFetch");

const PROJECT_URL_BASE = "https://api.artblocks.io/project";

// Response body from Art Blocks API when a project doesn't exist. (Yes, the
// status is 200 OK.)
const ENOENT = "project does not exist";

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
  if (html === ENOENT) return null;
  if (
    findByInnerText(body, "h3", /^Artist: (.*)$/)[1].length === 0 &&
    findByInnerText(body, "h3", /^Description: (.*)$/)[1].length === 0
  ) {
    // Projects like 128 and 155 appear to be abandoned drafts or something.
    // They have obscenely high invocation counts but no actual data or tokens.
    return null;
  }
  return {
    projectId: normalizeProjectId(projectId),
    artistName: findByInnerText(body, "h3", /^Artist: (.*)$/)[1],
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
    const match = el.text.match(re);
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
