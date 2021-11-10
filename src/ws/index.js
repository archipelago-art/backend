const util = require("util");

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

type NewTokensMessage = {
  type: "NEW_TOKENS",
  tokens: TokenData[],
};

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
            send(
              client,
              JSON.stringify({ type: "PONG", nonce: payload.nonce })
            );
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

function send(client, msg) {
  util
    .promisify(client.send.bind(client))(msg)
    .catch((e) => {
      console.error("failed to send message (%s) to client:", msg, e);
    });
}

module.exports = attach;
