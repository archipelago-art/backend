const util = require("util");

const slug = require("slug");

const artblocks = require("../db/artblocks");
const { acqrel } = require("../db/util");
const C = require("../util/combo");

const types = {};
types.tokenData = C.object({
  tokenId: C.number,
  tokenNewid: C.string,
  tokenIndex: C.number,
  traits: C.array(
    C.object({
      featureId: C.string,
      featureNewid: C.string,
      featureSlug: C.string,
      name: C.string,
      traitId: C.string,
      traitNewid: C.string,
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
  const imageProgress = new Map(
    (
      await acqrel(pool, (client) => artblocks.getImageProgress({ client }))
    ).map((row) => [row.projectId, row.completedThroughTokenId])
  );

  try {
    listenClientKeepalive = setInterval(async () => {
      if (!alive) return;
      await listenClient.query("SELECT 'websocketListenClientKeepalive'");
    }, 30 * 1000);

    listenClient.on("notification", async (n) => {
      if (n.channel !== artblocks.imageProgressChannel.name) return;
      const { projectId, completedThroughTokenId: newProgress } = JSON.parse(
        n.payload
      );
      const oldProgress = imageProgress.get(projectId);
      console.log(
        "pg->ws: image progress for %s changing from %s to %s",
        projectId,
        oldProgress,
        newProgress
      );
      if (oldProgress === newProgress) return;
      imageProgress.set(projectId, newProgress);
      if (newProgress == null) return;
      const tokens = await acqrel(pool, async (client) => {
        return addSlugs(
          await artblocks.getTokenFeaturesAndTraits({
            client,
            projectId,
            minTokenId: oldProgress ?? -1,
            maxTokenId: newProgress,
          })
        );
      });
      const msg = formatResponse({ type: "NEW_TOKENS", tokens });
      for (const ws of server.clients) {
        send(ws, msg);
      }
    });
    await artblocks.imageProgressChannel.listen(listenClient);

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
              await handleGetLatestTokens(ws, pool, imageProgress, request);
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
    console.error(e);
    await shutDown();
  }
}

function handlePing(ws, pool, request) {
  sendJson(ws, { type: "PONG", nonce: request.nonce });
}

async function getProjectId({ pool, slug }) {
  // temporary hack, pending this module being rewritten around newids
  const res = await pool.query(
    `
      SELECT project_id AS id FROM projects
      WHERE slug = $1
      `,
    [slug]
  );
  if (res.rows.length === 0) throw new Error("no collection by slug: " + slug);
  return res.rows[0].id;
}

async function handleGetLatestTokens(ws, pool, imageProgress, request) {
  const { lastTokenId } = request;
  const projectId = await getProjectId({ pool, slug: request.slug });
  const minTokenId = lastTokenId == null ? 0 : lastTokenId + 1;
  const maxTokenId = imageProgress.get(projectId) ?? -1;
  const tokens = await acqrel(pool, async (client) => {
    return addSlugs(
      await artblocks.getTokenFeaturesAndTraits({
        client,
        projectId,
        minTokenId,
        maxTokenId,
      })
    );
  });

  sendJson(ws, { type: "NEW_TOKENS", tokens });
}

function addSlugs(tokenFeaturesAndTraits) {
  return tokenFeaturesAndTraits.map((token) => ({
    ...token,
    traits: token.traits.map((trait) => ({
      ...trait,
      featureSlug: slug(trait.name),
      traitSlug: slug(String(trait.value)),
    })),
  }));
}

function send(ws, msg) {
  util
    .promisify(ws.send.bind(ws))(msg)
    .catch((e) => {
      console.error("failed to send message (%s) to client:", msg, e);
    });
}
function sendJson(ws, json) {
  send(ws, formatResponse(json));
}

module.exports = attach;
