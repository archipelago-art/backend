const util = require("util");

const api = require("../api");
const artblocks = require("../db/artblocks");
const { acqrel } = require("../db/util");
const C = require("../util/combo");
const log = require("../util/log")(__filename);
const slug = require("../util/slugify");

const types = {};
types.tokenData = C.object({
  projectId: C.string,
  tokenId: C.string,
  tokenIndex: C.number,
  traits: C.array(
    C.object({
      featureId: C.string,
      featureSlug: C.string,
      name: C.string,
      traitId: C.string,
      traitSlug: C.string,
      value: C.raw,
    })
  ),
});

const requestParser = C.sum("type", {
  PING: {
    nonce: C.string,
  },
  // Sent to request tokens for a collection.
  GET_LATEST_TOKENS: {
    slug: C.string,
    lastTokenIndex: C.orElse([C.null_, C.number]),
  },
});

const responseParser = C.sum("type", {
  PONG: {
    nonce: C.string,
  },
  // Sent when new tokens are minted or in response to a `GET_LATEST_TOKENS`
  // request.
  NEW_TOKENS: {
    tokens: C.array(types.tokenData),
  },
  ERROR: {
    httpStatus: C.number,
    message: C.string,
  },
});

// IP address of a websocket client, stashed on the websocket itself under this
// symbol.
const REMOTE_ADDRESS = Symbol("remoteAddress");

function formatResponse(json) {
  const parseResult = responseParser.parse(json);
  if (!parseResult.ok) {
    throw new Error("invalid response: " + parseResult.err);
  }
  return JSON.stringify(json);
}

async function attach(server, pool) {
  let alive = true;
  let listenClientKeepalive;
  const listenClient = await pool.connect();
  async function shutDown() {
    alive = false;
    clearInterval(listenClientKeepalive);
    listenClient.release(true);
  }
  // Map from project ID to last token index.
  const imageProgress = new Map(
    (
      await acqrel(pool, (client) => artblocks.getImageProgress({ client }))
    ).map((row) => [row.projectId, row.completedThroughTokenIndex])
  );
  log.debug`got initial image progress for ${imageProgress.size} projects`;

  try {
    listenClientKeepalive = setInterval(async () => {
      if (!alive) return;
      await listenClient.query("SELECT 'websocketListenClientKeepalive'");
    }, 30 * 1000);

    listenClient.on("notification", async (n) => {
      if (n.channel !== artblocks.imageProgressChannel.name) return;
      const payload = JSON.parse(n.payload);
      const newProgress = payload.completedThroughTokenIndex;
      const projectId = payload.projectId;
      const oldProgress = imageProgress.get(projectId);
      log.info`pg->ws: image progress for ${projectId} changing from ${oldProgress} to ${newProgress}: ${n.payload}`;
      if (oldProgress === newProgress) return;
      imageProgress.set(projectId, newProgress);
      if (newProgress == null) return;
      const tokens = await acqrel(pool, async (client) => {
        return formatOutgoingTokens(
          await artblocks.getTokenFeaturesAndTraits({
            client,
            projectId,
            minTokenIndex: oldProgress ?? -1,
            maxTokenIndex: newProgress,
          }),
          projectId
        );
      });
      const type = "NEW_TOKENS";
      const msg = formatResponse({ type, tokens });
      for (const ws of server.clients) {
        send(ws, type, msg);
      }
    });
    await artblocks.imageProgressChannel.listen(listenClient);

    server.on("connection", (ws, req) => {
      ws[REMOTE_ADDRESS] = req.socket.remoteAddress;
      const peer = req.socket.remoteAddress;
      ws.on("message", async (msgRaw) => {
        let msgJson;
        try {
          msgJson = JSON.parse(msgRaw);
        } catch (e) {
          const start = msgRaw.slice(0, 32);
          const rest = msgRaw.length > 32 ? "[...]" : "";
          log.warn`ignoring invalid-JSON message from client at ${ws[REMOTE_ADDRESS]}: ${start}${rest}`;
          return;
        }
        let request;
        try {
          request = requestParser.parseOrThrow(msgJson);
        } catch (e) {
          sendJson(ws, {
            type: "ERROR",
            httpStatus: 400,
            message: "invalid request: " + e.message,
          });
          return;
        }
        try {
          switch (request.type) {
            case "PING":
              await handlePing(ws, pool, request);
              break;
            case "GET_LATEST_TOKENS":
              await handleGetLatestTokens(ws, pool, imageProgress, request);
              break;
            default:
              log.error`unhandled request type: ${request.type}`;
          }
        } catch (e) {
          log.error`handling ${request.type} request: ${e}`;
          sendJson(ws, {
            type: "ERROR",
            httpStatus: 500,
            message: `internal error handling ${request.type} request`,
          });
        }
      });
    });

    return shutDown;
  } catch (e) {
    log.error`failed to initialize server: ${e}`;
    await shutDown();
  }
}

function handlePing(ws, pool, request) {
  sendJson(ws, { type: "PONG", nonce: request.nonce });
}

async function handleGetLatestTokens(ws, pool, imageProgress, request) {
  const { lastTokenIndex, slug } = request;
  const projectId = await acqrel(pool, (client) =>
    api.resolveProjectId({ client, slug })
  );
  const minTokenIndex = lastTokenIndex == null ? 0 : lastTokenIndex + 1;
  const maxTokenIndex = imageProgress.get(projectId) ?? -1;
  const tokens = await acqrel(pool, async (client) => {
    return formatOutgoingTokens(
      await artblocks.getTokenFeaturesAndTraits({
        client,
        projectId,
        minTokenIndex,
        maxTokenIndex,
      }),
      projectId
    );
  });

  sendJson(ws, { type: "NEW_TOKENS", tokens });
}

function formatOutgoingTokens(tokenFeaturesAndTraits, projectId) {
  return tokenFeaturesAndTraits.map((token) => ({
    ...token,
    projectId,
    traits: token.traits.map((trait) => ({
      ...trait,
      featureSlug: slug(trait.name),
      traitSlug: slug(String(trait.value)),
    })),
  }));
}

function send(ws, type, msg) {
  util
    .promisify(ws.send.bind(ws))(msg)
    .then(() => {
      log.trace`sent ${type} message to client at ${ws[REMOTE_ADDRESS]}`;
    })
    .catch((e) => {
      log.error`failed to send ${type} message to client at ${ws[REMOTE_ADDRESS]}: ${e}`;
    });
}
function sendJson(ws, json) {
  send(ws, json.type, formatResponse(json));
}

module.exports = attach;
