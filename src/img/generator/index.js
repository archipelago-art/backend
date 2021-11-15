const fs = require("fs");
const { join } = require("path");
const util = require("util");

const {
  evalUntrustedHtml,
  screenshotUntrustedHtml,
} = require("../../util/untrustedHtml");

const libraries = {
  js: null,
  p5js: "p5.min.js",
};

async function readLibraryData(library) {
  const filename = libraries[library];
  if (filename === null) return null;
  if (filename === undefined)
    throw new Error("unsupported library: " + library);
  const path = join(__dirname, "vendor", filename);
  return (await util.promisify(fs.readFile)(path)).toString();
}

const globalStyle = `\
html {
  height: 100%;
}
body {
  min-height: 100%;
  margin: 0;
  padding: 0;
}
canvas {
  padding: 0;
  margin: auto;
  display: block;
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
}
`;

async function template({ script, library }, tokenData) {
  const files = {};

  const libraryData = await readLibraryData(library);
  if (libraryData != null) {
    files["/lib.js"] = libraryData;
  }

  files["/script.js"] = script;

  const indexHtml = [];
  indexHtml.push("<!DOCTYPE html>");
  indexHtml.push("<html><head>");
  indexHtml.push('<meta charset="utf-8"/>');
  if (libraryData != null) {
    indexHtml.push('<script src="/lib.js"></script>');
  }
  indexHtml.push(
    `<script>let tokenData = ${JSON.stringify(tokenData)};</script>`
  );
  indexHtml.push('<script src="/script.js"></script>');
  indexHtml.push(`<style>${globalStyle}</style>`);
  indexHtml.push("</head></html>");
  files["/index.html"] = indexHtml.join("");

  return files;
}

function computeWindowSize(aspectRatio, dim = 2400) {
  if (typeof aspectRatio !== "number")
    throw new Error("windowSize: " + aspectRatio);
  if (aspectRatio <= 1) {
    return { width: Math.round(dim * aspectRatio), height: dim };
  } else {
    return { width: dim, height: Math.round(dim / aspectRatio) };
  }
}

// generatorData: { script: string, library: string, aspectRatio: number }
async function generate(generatorData, tokenData, outfile) {
  const files = await template(generatorData, tokenData);
  const windowSize = computeWindowSize(generatorData.aspectRatio);
  await screenshotUntrustedHtml(files, outfile, { windowSize });
}

module.exports = generate;
