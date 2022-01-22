const fs = require("fs");
const http = require("http");
const https = require("https");
const util = require("util");
const ws = require("ws");

const { withPool } = require("../db/util");
const log = require("../util/log")(__filename);
const attach = require("../ws");

async function tokenFeedWss(args) {
  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 0 || port > 0xffff)
    throw new Error("expected port argument; got: " + args[0]);
  let httpServer;
  const certFile = process.env.TLS_CERT_FILE;
  const keyFile = process.env.TLS_KEY_FILE;
  if (certFile && keyFile) {
    [cert, key] = await Promise.all(
      [certFile, keyFile].map((f) => util.promisify(fs.readFile)(f))
    );
    log.info`serving over TLS`;
    httpServer = https.createServer({ cert, key });
  } else {
    log.info`serving without TLS certificate`;
    httpServer = http.createServer({});
  }
  const wsServer = new ws.WebSocketServer({
    server: httpServer,
    clientTracking: true,
  });
  await withPool(async (pool) => {
    const shutDown = await attach(wsServer, pool);
    httpServer.listen(port);
    log.info`listening on port ${port}`;
    await new Promise((res) => {
      httpServer.once("close", async () => {
        await shutDown();
        res();
      });
    });
  });
}

module.exports = tokenFeedWss;
