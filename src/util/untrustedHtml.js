const child_process = require("child_process");
const http = require("http");
const util = require("util");

const Koa = require("koa");
const htmlParser = require("node-html-parser");

// Evaluates untrusted HTML and JavaScript in a Chromium sandbox and returns
// the inner text of the `body` element.
//
// The `files` argument should be a dict mapping URL paths like "/index.html"
// to file contents like "<!DOCTYPE html>...". Paths ending with ".html" or
// ".js" will be served with appropriate Content-Type headers; other files will
// have "application/octet-stream".
async function evalUntrustedHtml(files, options) {
  options = {
    entry: "/index.html",
    chromiumBinary: "chromium",
    ...options,
  };
  const rawHtml = await withFileServer(files, (port) =>
    spawnChromiumHeadless(options.chromiumBinary, [
      "--dump-dom",
      `http://localhost:${port}${options.entry}`,
    ])
  );
  const html = htmlParser.parse(rawHtml);
  const body = html.querySelector("body");
  return body.text;
}

// Evaluates untrusted HTML and JavaScript in a Chromium sandbox and saves a
// screenshot of the page to the given path.
//
// The `files` argument should be a dict mapping URL paths like "/index.html"
// to file contents like "<!DOCTYPE html>...". Paths ending with ".html" or
// ".js" will be served with appropriate Content-Type headers; other files will
// have "application/octet-stream".
//
// The `options` may include a `windowSize: { width: number, height: number }`.
async function screenshotUntrustedHtml(files, outputPath, options) {
  options = {
    entry: "/index.html",
    chromiumBinary: "chromium",
    windowSize: { width: 640, height: 480 },
    ...options,
  };
  const windowSizeFlagValue = [
    options.windowSize.width,
    options.windowSize.height,
  ].join(",");
  await withFileServer(files, (port) =>
    spawnChromiumHeadless(options.chromiumBinary, [
      `--window-size=${windowSizeFlagValue}`,
      `--screenshot=${outputPath}`,
      `http://localhost:${port}${options.entry}`,
    ])
  );
}

async function spawnChromiumHeadless(chromium, args) {
  return new Promise((res, rej) => {
    child_process.execFile(
      chromium,
      ["--headless", "--temp-profile", ...args],
      (err, stdout, stderr) => {
        if (err != null) {
          rej(err);
          return;
        }
        res(stdout);
      }
    );
  });
}

async function withFileServer(files, callback) {
  const app = new Koa();
  app.use((ctx) => {
    const { url } = ctx;
    const data = files[url];
    if (data == null) {
      ctx.status = 404;
      ctx.body = "Not Found\n";
      return;
    }
    if (url.endsWith(".html")) {
      ctx.type = "text/html";
    } else if (url.endsWith(".js")) {
      ctx.type = "application/javascript";
    } else {
      ctx.type = "application/octet-stream";
    }
    ctx.body = data;
  });
  const server = http.createServer(app.callback());
  const listening = new Promise((res, rej) => {
    server.once("listening", res);
    server.once("error", rej);
  });
  server.listen(0);
  try {
    await listening;
    const port = server.address().port;
    return await callback(port);
  } finally {
    await util.promisify(server.close.bind(server))();
  }
}

module.exports = { evalUntrustedHtml, screenshotUntrustedHtml };
