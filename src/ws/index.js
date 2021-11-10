const util = require("util");

const api = require("../api");
const artblocks = require("../db/artblocks");
const { acqrel } = require("../db/util");
const C = require("../util/combo");

const types = {};
types.tokenData = C.object({
  tokenId: C.number,
  traits: C.array(
    C.object({
      featureId: C.number,
      name: C.string,
      traitId: C.number,
      value: C.raw,
    })
  ),
});
types.collectionId = C.fmap(C.string, (s) => {
  const result = api.collectionNameToArtblocksProjectId(s);
  if (result == null) throw new Error("invalid collection ID: " + s);
  return result;
});

const requestParser = C.sum("type", {
  PING: {
    nonce: C.string,
  },
  // Sent to request tokens for a collection.
  GET_LATEST_TOKENS: {
    projectId: C.rename("collection", types.collectionId),
    lastTokenId: C.orElse([C.null_, C.number]),
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

async function attach(server, pool) {
  let alive = true;
  let listenClientKeepalive;
  const listenClient = await pool.connect();
  async function shutDown() {
    alive = false;
    clearInterval(listenClientKeepalive);
    listenClient.release(true);
  }

  try {
    listenClientKeepalive = setInterval(async () => {
      if (!alive) return;
      await listenClient.query("SELECT 'websocketListenClientKeepalive'");
    }, 30 * 1000);

    listenClient.on("notification", async (n) => {
      if (n.channel !== artblocks.newTokensChannel.name) return;
      const { projectId, tokenId } = JSON.parse(n.payload);
      console.log(
        "pg->ws: new_tokens { projectId: %s, tokenId: %s }",
        projectId,
        tokenId
      );
      const tokens = await acqrel(pool, async (client) => {
        return artblocks.getTokenFeaturesAndTraits({ client, tokenId });
      });
      const msg = JSON.stringify({ type: "NEW_TOKENS", tokens });
      for (const ws of server.clients) {
        send(ws, msg);
      }
    });
    await artblocks.newTokensChannel.listen(listenClient);

    server.on("connection", (ws) => {
      ws.on("message", async (msgRaw) => {
        let msgJson;
        try {
          msgJson = JSON.parse(msgRaw);
        } catch (e) {
          console.warn(
            "ignoring invalid-JSON message from client: %s%s",
            msgRaw.slice(0, 32),
            msgRaw.length > 32 ? "[...]" : ""
          );
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
              await handleGetLatestTokens(ws, pool, request);
              break;
            default:
              console.error("unhandled request type: %s", request.type);
          }
        } catch (e) {
          console.error(e);
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
    await shutDown();
  }
}

function handlePing(ws, pool, request) {
  sendJson(ws, { type: "PONG", nonce: request.nonce });
}

async function handleGetLatestTokens(ws, pool, request) {
  const { projectId, lastTokenId } = request;
  const minTokenId = lastTokenId == null ? 0 : lastTokenId + 1;
  const tokens = await acqrel(pool, async (client) => {
    return artblocks.getTokenFeaturesAndTraits({
      client,
      projectId,
      minTokenId,
    });
  });

  sendJson(ws, { type: "NEW_TOKENS", tokens });
}

function send(ws, msg) {
  util
    .promisify(ws.send.bind(ws))(msg)
    .catch((e) => {
      console.error("failed to send message (%s) to client:", msg, e);
    });
}
function sendJson(ws, json) {
  send(ws, JSON.stringify(json));
}

module.exports = attach;
