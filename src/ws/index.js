const util = require("util");

const api = require("../api");
const artblocks = require("../db/artblocks");
const { acqrel } = require("../db/util");

/*::
type PingMessage = {
  type: "PING",
  nonce: string,
};
type PongMessage = {
  type: "PONG",
  nonce: string,
};

// Sent from server to client when new tokens are minted.
type NewTokensMessage = {
  type: "NEW_TOKENS",
  tokens: TokenData[],
};

// Sent from client to server to request tokens for a collection.
type GetLatestTokensMessage = {
  type: "GET_LATEST_TOKENS",
  collection: string,
  lastTokenId: number | null,  // fetch only token IDs higher than this one
}

// Sent from server to client to indicate a bad incoming message.
type ErrorMessage = {
  type: "ERROR",
  httpStatus: number,
  message: string,
}

type TokenData = {
  tokenId: number,
  traits: {
    featureId: number,
    name: string,
    traitId: number,
    value: JsonValue,
  }
};
*/

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
      for (const client of server.clients) {
        send(client, msg);
      }
    });
    await artblocks.newTokensChannel.listen(listenClient);

    server.on("connection", (client) => {
      client.on("message", (msg) => {
        let payload;
        try {
          payload = JSON.parse(msg);
        } catch (e) {
          console.warn(
            "ignoring invalid-JSON message from client: %s%s",
            msg.slice(0, 32),
            msg.length > 32 ? "[...]" : ""
          );
          return;
        }
        switch (payload.type) {
          case "PING":
            handlePing(client, pool, payload);
            break;
          case "GET_LATEST_TOKENS":
            handleGetLatestTokens(client, pool, payload);
            break;

          default:
            console.warn("ignoring unknown message type: %s", payload.type);
        }
      });
    });

    return shutDown;
  } catch (e) {
    await shutDown();
  }
}

function handlePing(client, pool, payload) {
  sendJson(ws, { type: "PONG", nonce: payload.nonce });
}

async function handleGetLatestTokens(client, pool, payload) {
  const { collection, lastTokenId } = payload;
  if (typeof collection !== "string") {
    sendJson(client, {
      type: "ERROR",
      httpStatus: 400,
      message: "collection should be a string",
    });
    return;
  }
  const projectId = api.collectionNameToArtblocksProjectId(collection);
  if (projectId == null) {
    sendJson(client, {
      type: "ERROR",
      httpStatus: 400,
      message: "invalid collection ID",
    });
    return;
  }
  if (
    lastTokenId !== null &&
    (!Number.isInteger(lastTokenId) || !(lastTokenId >= 0))
  ) {
    sendJson(client, {
      type: "ERROR",
      httpStatus: 400,
      message: "lastTokenId should be a non-negative integer or null",
    });
    return;
  }
  const minTokenId = lastTokenId == null ? 0 : lastTokenId + 1;
  const tokens = await acqrel(pool, async (client) => {
    return artblocks.getTokenFeaturesAndTraits({
      client,
      projectId,
      minTokenId,
    });
  });

  sendJson(client, { type: "NEW_TOKENS", tokens });
}

function send(client, msg) {
  util
    .promisify(client.send.bind(client))(msg)
    .catch((e) => {
      console.error("failed to send message (%s) to client:", msg, e);
    });
}
function sendJson(client, json) {
  send(client, JSON.stringify(json));
}

module.exports = attach;
