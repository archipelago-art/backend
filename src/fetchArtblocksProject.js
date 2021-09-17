const fetch = require("node-fetch");
const htmlParser = require("node-html-parser");

const PROJECT_URL_BASE = "https://api.artblocks.io/project";

async function fetchProjectHtml(projectId) {
  const url = `${PROJECT_URL_BASE}/${projectId}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`fetching ${url}: ${res.status} ${res.statusText}`);
  return await res.text();
}

function parseProjectData(html) {
  const body = htmlParser.parse(html);
  return {
    name: findByInnerText(body, "h1", /^Name: (.*)$/)[1],
    size: Number.parseInt(
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
  return parseProjectData(await fetchProjectHtml(projectId));
}

module.exports = {
  fetchProjectHtml,
  parseProjectData,
  fetchProjectData,
};
